"use strict";

Components.utils.import("resource://gre/modules/Task.jsm");

(function (global) {

  let AnkPixivModule = function (doc) {

    var self = this;

    self.curdoc = doc;

    self.viewer;

    self.marked = false;

    self._functionsInstalled = false;

    /********************************************************************************
    * プロパティ
    ********************************************************************************/

    self.in = {
      get manga () {
        return self.info.illust.mangaPages > 1
      },
      get medium () {
        return self.in.illustPage;
      },
      get illustPage () {
        return self.info.illust.pageUrl.match(/^https?:\/\/(?:[^/]+\.)deviantart\.com\/(?:[^/]*\/)art\//);
      },
    };

    self.elements = (function () {
      const query    = q => self.elements.doc.querySelector(q);
      const queryAll = q => self.elements.doc.querySelectorAll(q);

      let illust =  {
        get avatar ()        { return query('[data-hook=user_avatar]'); },
        get originalImage () { return query('[data-hook=art_stage] img[aria-hidden]'); },
        get comment()        { return query('.legacy-journal')||{}; },
        get downloadedDisplayParent() { return query('[data-hook=art_stage]'); },
      };

      return {
        illust,
        get doc () { return self.curdoc; },
      };
    })();

    self.info = (function () {
      let illust = {
        get pageUrl ()  { return self.elements.doc.location.href; },
        get id ()       { return self.getIllustId(); },
        dateTime: undefined,
        title: undefined,
        get comment() { return self.elements.illust.comment.innerText; },
        R18: false,
        mangaPages: 1,
        worksData: null,

        tags: [],
        shortTags: [],

        width: undefined,
        height: undefined,
        get size() { return {width: illust.width, height:illust.height}; },

        get referer () { return self.info.illust.pageUrl; },
      };

      let member = {
        pixivId: undefined,
        id: undefined,
        name: undefined,
      };

      let path = {
        get initDir () {
          return AnkBase.Prefs.get('initialDirectory.' + self.SITE_NAME);
        },
        ext: undefined,
        mangaIndexPage: undefined,
        image: undefined,
      };

      return { illust, member, path };
    })();

  };


  AnkPixivModule.prototype = {

    /********************************************************************************
     * 定数
     ********************************************************************************/

    URL:        'http://www.deviantart.com/',  // イラストページ以外でボタンを押したときに開くトップページのURL
    DOMAIN:     'deviantart.com',              // CSSの適用対象となるドメイン
    SERVICE_ID: 'dART',                         // 履歴DBに登録するサイト識別子
    SITE_NAME:  'DeviantArt',                  // ?site-name?で置換されるサイト名のデフォルト値

    /********************************************************************************
     * 
     ********************************************************************************/

    /**
     * このモジュールの対応サイトかどうか
     */
    isSupported: function (doc) {
      return doc.location.href.match(/^https?:\/\/(?:[^/]+\.)deviantart\.com\//);
    },

    /**
     * ファンクションのインストール
     */
    initFunctions: function () {
      if (this._functionsInstalled)
        return;

      this._functionsInstalled = true;

      var inits = function () {
        if (self.in.medium) {
          self.installMediumPageFunctions();
        } else {
          self.installListPageFunctions();
        }
      };

      var self = this;
      var doc = this.curdoc;

      // ページ移動
      var contentChange = function () {
        let content = self.curdoc.querySelector('body');
        if (!(content && doc.readyState === 'complete')) {
          return false;   // リトライしてほしい
        }

        new MutationObserver(function (o) {
          var rise = false;
          o.forEach(function (a) {
            Array.slice(a.addedNodes).forEach(function (e) {
              AnkUtils.dumpError(e);
              if (e.tagName.toLowerCase() === 'footer' && 'depths' === e.id) {
                rise = true;
              }
            });
          });
          if (rise) {
            let q = self.curdoc.getElementById('#ank-pixiv-large-viewer-panel');
            if (q) {
              q.parentNode.removeChild(q);
            }

            AnkUtils.dump('rise contentChange: ' + self.curdoc.location.href);
            inits();
          }
        }).observe(content, {childList: true});

        return true;
      };

      //

      inits();

      AnkBase.delayFunctionInstaller(contentChange, 500, 60, self.SITE_NAME, 'contentChange');
    },

    /**
     * ダウンロード可能か
     */
    isDownloadable: function () {
      if (this._functionsInstalled && this.in.medium)
        return {illust_id: this.getIllustId(), service_id: this.SERVICE_ID};
    },

    /**
     * イラストID
     */
    illustIdRegex: /\/art\/.*-(\d+?)(?:\/|#?$)/,
    getIllustId: function (a) {
      let m = this.curdoc.location.href.match(this.illustIdRegex);
      return m && m[1];
    },

    /**
     * ダウンロード実行
     */
    downloadCurrentImage: function (useDialog, debug) {
      let self = this;
      Task.spawn(function *() {
        let image = yield self.getImageUrlAsync(AnkBase.Prefs.get('downloadOriginalSize', false));
        if (!image || image.images.length == 0) {
          window.alert(AnkBase.Locale.get('cannotFindImages'));
          return;
        }

        let context = new AnkBase.Context(self);
        let ev = AnkBase.createDownloadEvent(context, useDialog, debug);
        window.dispatchEvent(ev);
      }).catch(e => AnkUtils.dumpError(e,true));
    },

    /*
     * ダウンロード済みイラストにマーカーを付ける
     *    node:     対象のノード (AutoPagerize などで追加されたノードのみに追加するためにあるよ)
     *    force:    追加済みであっても、強制的にマークする
     */
    markDownloaded: function (node, force, ignorePref) {
      const Targets = [ ['a[data-hook=deviation_link]', 2] ];

      return AnkBase.markDownloaded(this.illustIdRegex, Targets, true, this, node, force, ignorePref);
    },

    /*
     * 評価する
     */
    setRating: function () {
      return true;
    },

    /********************************************************************************
     * 
     ********************************************************************************/

    /**
     * 画像URLリストの取得
     */
    getImageUrlAsync: function (mangaOriginalSizeCheck) {
      let self = this;
      return Task.spawn(function* () {
        const image = (self.elements.illust.originalImage || {}).src;
        if (!image) return null;

        const referer   = self.info.illust.referer;
        const page_url  = self.info.illust.pageUrl;
        const query_url = `https://backend.deviantart.com/oembed?url=${page_url}`
        const json      = JSON.parse(yield AnkUtils.httpGETAsync(query_url, referer));

        self.info.illust.dateTime = AnkUtils.getDecodedDateTime(new Date(json.pubdate));
        self.info.illust.title    = json.title;
        if (json.tags)
          self.info.illust.tags   = Array.map(json.tags.split(','), String.trim);
        self.info.member.pixivId       = json.author_name;
        self.info.member.id            = json.author_name;
        self.info.member.name          = json.author_name;
        self.info.path.ext = AnkUtils.getFileExtension(image.substr(0, image.indexOf('?')))
        self.info.path.image = {images:[image], facing:null};
        return self.info.path.image;
      });
    },

    /********************************************************************************
     * 
     ********************************************************************************/

    /*
     * イラストページにviewerやダウンロードトリガーのインストールを行う
     */
    installMediumPageFunctions: function () {
      let proc = function () {
        // 保存済み表示
        AnkBase.insertDownloadedDisplayById(
          self.elements.illust.downloadedDisplayParent,
          self.info.illust.R18,
          self.info.illust.id,
          self.SERVICE_ID
        );

        // 保存済み表示
        self.markDownloaded(doc,true);

        return true;
      };

      var self = this;
      var doc = this.curdoc;

      // install now
      return AnkBase.delayFunctionInstaller(proc, 500, 20, self.SITE_NAME, '');
    },

    /*
     * リストページ用ファンクション
     */
    installListPageFunctions: function () { /// {

      let delayMarking = function () {
        var body = self.elements.illust.body;

        if (!(body && doc.readyState === 'complete')) {
          return false;   // リトライしてほしい
        }

        // リスト表示が遅くてダウンロードマーク表示が漏れることがあるので、再度処理を実行
        self.markDownloaded(doc,true);

        return true;
      };

      var self = this;
      var doc = this.curdoc;

      // install now
      return AnkBase.delayFunctionInstaller(delayMarking, 500, 20, self.SITE_NAME, 'delayMarking');
    }

  };

  // --------
  global["SiteModule"] = AnkPixivModule;

})(this);
