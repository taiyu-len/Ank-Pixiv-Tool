"use strict";

Components.utils.import("resource://gre/modules/Task.jsm");

(function (global) {

  function AnkPixivModule(doc) {

    var self = this;

    self.curdoc = doc;

    self.viewer;

    self.marked = false;

    self._functionsInstalled = false;

    self._image = {
      thumbnail: null,
      original: null
    };

    /********************************************************************************
    * プロパティ
    ********************************************************************************/

    self.in = { // {{{
      get manga () {
        let loc = self.info.illust.pageUrl;
        return !!(
          loc.match(/member_illust\.php\?/) &&
          loc.match(/(?:&|\?)mode=manga(?:&|$)/) &&
          loc.match(/(?:&|\?)illust_id=\d+(?:&|$)/)
        );
      },
      get ugoira () { // {{{
        let e = self.elements.illust.mediumImage;
        return e && e.tagName.toLowerCase() === 'canvas';
      }, // }}}

      get medium () { // {{{
        let loc = self.info.illust.pageUrl;
        return !!(
          loc.match(/member_illust\.php\?/) &&
          loc.match(/(?:&|\?)mode=medium(?:&|$)/) &&
          loc.match(/(?:&|\?)illust_id=\d+(?:&|$)/)
        );
      }, // }}}

      get illustPage () { // {{{
        return self.in.medium;
      }, // }}}

      /*
       * 以下はモジュールローカル部品
       */

      // elementsを使っているが確定後にしか使わないのでOK
      get feed () { // {{{
        return self.elements.illust.feedList;
      }, // }}}

      get illustList () { // {{{
        return self.info.illust.pageUrl.match(/\.pixiv\.net\/member_illust.php\?id=/);
      }, // }}}

      get bookmarkNew () {// {{{
        return self.info.illust.pageUrl.match(/\.pixiv\.net\/bookmark_new_illust\.php/);
      }, // }}}

      get bookmarkAdd () {// {{{
        return self.info.illust.pageUrl.match(/\.pixiv\.net\/bookmark_add\.php\?/);
      }, // }}}

      get bookmarkList () { // {{{
        return self.info.illust.pageUrl.match(/\.pixiv\.net\/bookmark\.php/);
      }, // }}}

      get feedList () { // {{{
        return self.info.illust.pageUrl.match(/\.pixiv\.net\/stacc\//);
      }, // }}}

      get rankingList () { // {{{
        return self.info.illust.pageUrl.match(/\.pixiv\.net\/ranking\.php/);
      } // }}}
    }; // }}}

    self.elements = (function () { // {{{
      const query    = q => self.elements.doc.querySelector(q);
      const queryAll = q => self.elements.doc.querySelectorAll(q);

      let illust = {
        get largeLink () query("._1-h8Se6"),
        get datetime ()  query(".css-d16zpw"),
        get title ()     query('.css-6njqb8'),
        get comment ()   query('.EG8MDwA p._3nJtUNj'),
        get userName ()  query('.css-cwb1fq'),
        get memberLink ()query('.css-cwb1fq'),
        get tags ()      queryAll('._3SAblVQ > li'),
        get R18 ()       query('._3SAblVQ a[href*="R-18"]'),
        get pages ()     query('.gVu_bev'),
        get bookmark ()  query('button.qtQbBkD'),
        // Unused
        get size ()      query('.meta > li+li'), // XXX
        get tools ()     query('.tools'), // XXX
        get thumbnail () query('.bookmark_modal_thumbnail'), // XXX
        get feedLink ()  query('.tab-feed, .column-header .tabs a[href^="/stacc/"]'), // XXX

        // この作品をブックマークした人はこんな作品もブックマークしています
        // あなたのブックマークタグ「○○」へのおすすめ作品
        get recommendList ()     query('#illust-recommend ._image-items'),
        get ugoiraContainer ()   query('.works_display ._ugoku-illust-player-container'),
        get feedList()           query('#stacc_timeline, #stacc_center_timeline'),
        get rankingList()        query('.ranking-items'),
        get autoPagerizeTarget() queryAll('._unit'),
        get nextLink()           query('._3FJ1FEb.Dn9Rstg'),
        get prevLink()           query('._3FJ1FEb.WTz_C1E'),
        get uiLayoutWest ()      query('.ui-layout-west'),

        // require for AnkBase
        get downloadedDisplayParent () query('._2qAWahw'),
        get downloadedFilenameArea ()  query('.ank-pixiv-downloaded-filename-text'),

        // require for AnkBase.Viewer
        get body ()         queryAll('body')[0],
        get mediumImage ()  query('._1tR0cJT ._2r_DywD'),
        get imageOverlay () query('._1tR0cJT'),
        get openCaption ()  query('._1MskjZd'),

        get ads () {
          const Ads = [
            'object',
            'iframe',
            '.ui-search',
            'form.search2',          // 検索欄も広告扱いしちゃうぞ
            '#global-header',        // ヘッダ
            '.header',
            '._header',
            '#toolbar-items',        // toolbar
            '._toolmenu',            // 閲覧履歴ボタン
            '#gm_ldrize',            // ldrize
            '#header-banner',
            '.multi-ads-area'
          ];

          let a = [];
          Ads.forEach(q => AnkUtils.A(queryAll(q)).forEach(e => a.push(e)));
          return a;
        }
      };

      return {
        illust: illust,
        get doc () self.curdoc
      };
    })(); // }}}

    self.info = (function () { // {{{
      let illust = {
        get pageUrl () self.elements.doc.location.href,
        get id ()      self.getIllustId(),
        get dateTime () AnkUtils.decodeDateTimeText(self.elements.illust.datetime.textContent),
        get size () undefined,
        get pages () {
          e = self.elements.illust.pages;
          return e ? e.textContent.split('/')[1] : 1;
        },

        get tags ()
          AnkUtils.A(self.elements.illust.tags)
          .map(e =>AnkUtils.trim(e.textContent))
          .filter(s => s && s.length),

        get shortTags () self.info.illust.tags,
        get tools () {
          let e = self.elements.illust.tools;
          return e && AnkUtils.trim(e.textContent);
        },

        get width ()  (illust.size || {}).width,
        get height () (illust.size || {}).height,
        get server () {
          let a = self.info.path.image.images;
          if (a.length > 0) {
            let m = a[0].match(/^https?:\/\/([^\/\.]+)\./i);
            return m && m[1]
          }
        },

        get updated () {
          let e = self.elements.illust.thumbnail;
          return e && self.decodeUpdated(e.getAttribute('data-src'));
        },

        get referer () self.info.illust.pageUrl,
        get title () AnkUtils.trim(self.elements.illust.title.textContent),
        get comment () (self.elements.illust.comment || {}).textContent,
        get R18 () !!self.elements.illust.R18,

        get animationFrames() {
          try {
            let ugoku = self.elements.doc.defaultView.wrappedJSObject.pixiv.context.ugokuIllustData;
            if (ugoku) {
              let frames = ugoku.frames;
              if (frames)
                return frames.map(o => o.file+','+o.delay);
            }
          } catch(e) {}
        }
      };

      let member = {
        get id () self.elements.illust.memberLink.href.match(/\/member\.php\?id=(\d+)/)[1],

        // XXX 遅延が酷いとavatar.srcで例外発生？
        get pixivId () {
          let e = self.elements.illust.feedLink;
          let m = e && e.href.match(/\/stacc\/([^\?\/]+)/);
          if (m)
            return m[1];
        },

        get name () AnkUtils.trim(self.elements.illust.userName.textContent)
      };

      let path = {
        get initDir () {
          return AnkBase.Prefs.get('initialDirectory.' + self.SITE_NAME);
        },

        get ext () {
          return AnkUtils.getFileExtension(path.image.images.length > 0 && path.image.images[0]);
        },

        get ugokuIllustSrc () {
          try {
            let context = self.elements.doc.defaultView.wrappedJSObject.pixiv.context;
            if (!context)
              return;

            let illustSize = context.illustSize;
            let dataSzie = context.ugokuIllustData && context.ugokuIllustData.size;

            let dataSrc = context.ugokuIllustData && context.ugokuIllustData.src;
            let fullDataSrc = context.ugokuIllustFullscreenData && context.ugokuIllustFullscreenData.src;

            // サイズ情報が見つからなければフルスクリーン用を選択
            if (!illustSize || !dataSzie)
              return fullDataSrc || dataSrc;

            // 投稿サイズと通常zipのサイズが同じなら通常zipを選択
            return (illustSize[0] == dataSzie[0] && illustSize[1] == dataSzie[1]) && dataSrc || fullDataSrc;
          } catch(e) {}
        },

        // ダウンロード時のみの利用なので downloadOriginalSize のチェックだけでよい
        get image () self._image.original
      };

      return {
        illust: illust,
        member: member,
        path: path
      };
    })(); // }}}

  };


  AnkPixivModule.prototype = {

    /********************************************************************************
     * 定数
     ********************************************************************************/

    URL:        'http://www.pixiv.net/',
    DOMAIN:     'www.pixiv.net',
    SERVICE_ID: 'PXV',
    SITE_NAME:  'Pixiv',

    /********************************************************************************
     *
     ********************************************************************************/

    /**
     * このモジュールの対応サイトかどうか
     */
    isSupported: function (doc) {
      return doc.location.href.match(/^https?:\/\/www\.pixiv\.net\//);
    },

    /**
     * ファンクションのインストール
     */
    initFunctions: function () {
      // TODO reinit if url has changed
      if (this._functionsInstalled)
        return;

      this._functionsInstalled = true;

      if (this.in.medium || this.in.manga) {
        this.installMediumPageFunctions();
      }
      else {
        this.installListPageFunctions();
      }
    },

    /**
     * ダウンロード可能か
     */
    isDownloadable: function () {
      if (!this._functionsInstalled)
        return false;

      if (this.in.medium || this.in.manga)
        return { illust_id:this.getIllustId(), service_id:this.SERVICE_ID };
    },

    /**
     * イラストID
     */
    getIllustId: function () {
      let m = this.curdoc.location.href.match(/illust_id=(\d+)/);
      return m && parseInt(m[1], 10);
    },

    /**
     * ダウンロード実行
     */
    downloadCurrentImage: function (useDialog, debug) {
      let self = this;
      Task.spawn(function () {
        let image = yield self.getImageUrlAsync(AnkBase.Prefs.get('downloadOriginalSize', true));
        if (!image || image.images.length == 0) {
          window.alert(AnkBase.Locale.get('cannotFindImages'));
          return;
        }

        let context = new AnkBase.Context(self);
        let ev = AnkBase.createDownloadEvent(context, useDialog, debug);
        window.dispatchEvent(ev);
      }).catch(e => AnkUtils.dumpError(e, true));
    },

    /*
     * ダウンロード済みイラストにマーカーを付ける
     *    node:     対象のノード (AutoPagerize などで追加されたノードのみに追加するためにあるよ)
     *    force:    追加済みであっても、強制的にマークする
     */
    markDownloaded: function (node, force, ignorePref) { // {{{
      const IsIllust = /&illust_id=(\d+)/;
      const Targets = [
                        ['li > a.work', 1],                       // 作品一覧、ブックマーク
                        ['.rank-detail a._work', 2],              // ホーム（ランキング）
                        ['.ranking-item a._work', 2],             // ランキング
                        ['.worksListOthersImg > ul > li > a', 1], // プロファイル（ブックマーク、イメージレスポンス）
                        ['.worksImageresponseImg > a', 2],        // イラストページ（イメージレスポンス）
                        ['li > a.response-in-work', 1],           // イラストページ（イメージレスポンス）
                        ['.search_a2_result > ul > li > a', 1],   // イメージレスポンス
                        ['.stacc_ref_illust_img > a', 3],         // フィード（お気に入りに追加したイラスト）
                        ['.stacc_ref_user_illust_img > a', 1],    // フィード（お気に入りに追加したユーザ内のイラスト）
                        ['.hotimage > a.work', 1],                // タグページ（週間ベスト）
                        ['.image-item > a:nth-child(1)', 1],      // タグページ（全期間＆新着）
                        ['.sibling-items > .after > a', 1],       // 前の作品
                        ['.sibling-items > .before > a', 1]       // 次の作品
                      ];

      return AnkBase.markDownloaded(IsIllust, Targets, false, this, node, force, ignorePref);
    }, // }}}

    getUpdated: function (box) {
      let e = box && box.querySelector('img');
      return this.decodeUpdated(e && e.src);
    },

    decodeUpdated: function (s) {
      if (!s)
        return;
      let m = s.match(/\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})\/(\d{2})\/\d{2}\//);
      return m && m[1]+m[2]+m[3]+m[4]+m[5];
    },

    /*
     * 評価する
     */
    setRating: (pt) => true,

    /********************************************************************************
     *
     ********************************************************************************/

    /**
     * 画像URLリストの取得
     */
    getImageUrlAsync: function (mangaOriginalSizeCheck) {
      let self = this;

      // TODO 長すぎる
      return Task.spawn(function* () {

        // 取得済みならそのまま返す(ここはsetSelectedImageではない)
        if (self._image.original && self._image.original.images.length > 0) {
          return self._image.original;
        }

        function setSelectedImage (image) {
          self._image.original = image.original;
          return image.original;
        }

        let referer = self.info.illust.pageUrl;

        // うごイラ
        if (self.in.ugoira) {
          let src = self.info.path.ugokuIllustSrc;
          if (src)
            return setSelectedImage({ original: { images: [ src ], facing: null, referer: referer } });
          return null;
        }
        return yield Task.spawn(function* () {
          let url = `https://www.pixiv.net/ajax/illust/${self.info.illust.id}/pages`
          AnkUtils.dump(`Requesting from '${url}'`)
          try {
            let response = yield AnkUtils.httpGETAsync(url, referer)
            let json = JSON.parse(response);
            if (json.error)
              throw new Error(`${url}:${json.message}`);
            let images = [];
            for (let img of json.body)
              images.push(img.urls.original)
            return setSelectedImage({
              original:{ images, facing:null, referer }
            });
          } catch (e) {
            AnkUtils.dumpError(e, true)
            return null;
          }
        })
      });
    },

    /********************************************************************************
     * 
     ********************************************************************************/

    /*
     * イラストページにviewerやダウンロードトリガーのインストールを行う
     */
    installMediumPageFunctions: function () { // {{{
      let proc = function () {
        // インストールに必用な各種要素
        var body = self.elements.illust.body;
        var medImg = self.elements.illust.mediumImage;

        // 完全に読み込まれていないっぽいときは、遅延する
        if (!(body && medImg)) { // {{{
          return false;   // リトライしてほしい
        } // }}}

        let addRatingEventListener = function () {
          let bm = self.element.illust.bookmark;
          if (bm) {
            let fn = function() { AnkBase.downloadCurrentImageAuto(self); };
            bm.addEventListener('click', fn);
          }
        };
        // レイティングによるダウンロード
        if (AnkBase.Prefs.get('downloadWhenRate', false))
          addRatingEventListener();

        // 保存済み表示
        AnkBase.insertDownloadedDisplayById(
          self.elements.illust.downloadedDisplayParent,
          self.info.illust.R18,
          self.info.illust.id,
          self.SERVICE_ID,
          self.info.illust.updated
        );

        // イメレスにマーキング
        self.markDownloaded(doc,true);

        // キャプションを開く
        if (AnkBase.Prefs.get('openCaption', false) && openCaption && openCaption.style.display === 'block')
          setTimeout(() => openCaption.click(), 1000);

        return true;
      }; // }}}

      var self = this;
      var doc = this.curdoc;

      // install now
      return AnkBase.delayFunctionInstaller(proc, 500, 20, self.SITE_NAME, '');
    }, // }}}

    /*
     * リストページのアイテムにダウンロード済みマークなどをつける
     */
    installListPageFunctions: function () { /// {

      // TODO AutoPagerizeと違い、追加伸長した要素だけでなく、すべての要素のチェックが走る
      let followExpansion = function () {
        var recommend = self.elements.illust.recommendList;
        var feed = self.elements.illust.feedList;
        var ranking = self.elements.illust.rankingList;

        let elm = recommend || feed || ranking;
        if (!elm) {
          return false;     // リトライしてほしい
        }

        // 伸びるおすすめリストに追随する
        new MutationObserver(function (o) {
          o.forEach(e => self.markDownloaded(e.target, true));
        }).observe(elm, {childList: true});

        return true;
      };

      let autoPagerize = function () {
        var aptarget = self.elements.illust.autoPagerizeTarget;

        if (!(doc && aptarget)) {
          return false;     // リトライしてほしい
        }

        // AutoPagerizeによる継ぎ足し動作
        // TODO サイト別.jsに個別に書くのはよくない気がする
        doc.addEventListener(
          'AutoPagerize_DOMNodeInserted',
          function (e) {
            let a = [];
            if (e.target.classList.contains('image-item')) {
              a.push(e.target);
            }
            else {
              [
                '._image-items > li',              // フォロー新着作品＆○○さんの作品一覧
                '.ranking-items > .ranking-item'  // ランキング
              ].
                some(function (q) {
                  let n = e.target.querySelectorAll(q);
                  return n && n.length > 0 && !!(a = AnkUtils.A(n));
                });
            }
            if (a && a.length > 0)
              a.forEach(node => self.markDownloaded(node, true));
          },
          false
        );

        return true;
      };

      let delayMarking = function () {
        if (typeof doc === 'undefined' || !doc || doc.readyState !== "complete") {
          return false;     // リトライしてほしい
        }

        // プレミアムユーザーでない絵師さんの作品一覧は遅延が発生するのでonFocusによる処理だけではマークがつかない
        self.markDownloaded(doc,true);

        return true;
      };

      var self = this;
      var doc = this.curdoc;

      // install now
      if (AnkBase.Prefs.get('markDownloaded', false)) {
        if (this.in.bookmarkList || this.in.bookmarkAdd || this.in.feedList || this.in.rankingList) {
          AnkBase.delayFunctionInstaller(followExpansion, 500, 20, self.SITE_NAME, 'followExpansion');
        }
        AnkBase.delayFunctionInstaller(autoPagerize, 500, 20, self.SITE_NAME, 'autoPagerize');
        AnkBase.delayFunctionInstaller(delayMarking, 500, 20, self.SITE_NAME, 'delayMarking');
      }
    }

  };

  // --------
  global["SiteModule"] = AnkPixivModule;

})(this);
