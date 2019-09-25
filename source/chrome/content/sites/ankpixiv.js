"use strict";

Components.utils.import("resource://gre/modules/Task.jsm");

(function (global) {

  function AnkPixivModule (doc) {

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
        let loc = self.info.illust.pageUrl;
        return !!loc.match(/artworks\//);
      },
      get medium () {
        let loc = self.info.illust.pageUrl;
        return !!loc.match(/artworks\//);
      },
      get illustPage () { return self.in.medium; },
    };

    self.elements = (function () {
      const query    = q => self.elements.doc.querySelector(q);
      const queryAll = q => self.elements.doc.querySelectorAll(q);

      let illust = {
        // require for AnkBase
        downloadedDisplayParent: undefined,
        get downloadedFilenameArea ()  { return query('.ank-pixiv-downloaded-filename-text'); },

        // require for AnkBase.Viewer
        get body () { return queryAll('body')[0]; },
        openCaption: undefined,

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
        get doc () { return self.curdoc; },
      };
    })();

    self.info = (function () {
      let illust = {
        get id ()      { return self.getIllustId(); },
        get pageUrl () { return self.curdoc.location.href; },
        title: undefined,
        comment: undefined,
        R18: false,
        dateTime: undefined,
        tags: [],
        width: undefined,
        height: undefined,
        // { type:str, id:int, title:str, order:int }
        series: undefined,
        boothId: undefined,

        get size () { return {width: illust.width, height: illust.height}; },
        shortTags: [],
        get referer () { return self.info.illust.pageUrl; },
        animationFrames: undefined
      };

      let member = {
        id: undefined,
        pixivId: undefined,
        name: undefined
      };

      let path = {
        get initDir () {
          return AnkBase.Prefs.get('initialDirectory.' + self.SITE_NAME);
        },
        ext: undefined,
        // ダウンロード時のみの利用なので downloadOriginalSize のチェックだけでよい
        image: undefined,
      };

      return {
        illust: illust,
        member: member,
        path: path
      };
    })();
  }


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
      this._functionsInstalled = true;
    },

    /**
     * ダウンロード可能か
     */
    isDownloadable: function () {
      if (this.in.medium || this.in.manga)
        return { illust_id:this.getIllustId(), service_id:this.SERVICE_ID };
    },

    /**
     * イラストID
     */
    getIllustId: function () {
      let m = this.info.illust.pageUrl.match(/\/artworks\/(\d+)/);
      return m && m[1];
    },

    /**
     * ダウンロード実行
     */
    downloadCurrentImage: function (useDialog, debug) {
      let self = this;
      Task.spawn(function *() {
        let image = yield self.getImageUrlAsync();
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
    markDownloaded: function (node, force, ignorePref) {
      return null;
    },

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
    getImageUrlAsync: function () {
      let self = this;
      return Task.spawn(function* () {
        const referer   = self.info.illust.referer;
        const illust_id = self.info.illust.id;
        const url       = `https://www.pixiv.net/ajax/illust/${illust_id}`;
        function check(json) {
          if (json.error)
            throw new Error(`${url}:${json.message}`);
        }
        const json = JSON.parse(yield AnkUtils.httpGETAsync(url, referer));
        check(json);

        self.info.illust.title    = json.body.illustTitle;
        self.info.illust.comment  = json.body.illustComment;
        self.info.illust.R18      = json.body.xRestrict == 1;
        self.info.illust.dateTime = AnkUtils.getDecodedDateTime(new Date(json.body.uploadDate));
        self.info.illust.tags     = json.body.tags.tags.map(x => x.tag);
        self.info.illust.width    = json.body.width;
        self.info.illust.height   = json.body.height;
        self.info.illust.series   = json.body.seriesNavData ? {
          type:  json.body.seriesNavData.seriesType,
          id:    json.body.seriesNavData.seriesId,
          title: json.body.seriesNavData.title,
          order: json.body.seriesNavData.order,
        } : undefined;
        self.info.illust.boothId = json.body.descriptionBoothId;
        self.info.illust.animationFrames = undefined;

        self.info.member.id      = json.body.userId;
        self.info.member.pixivId = json.body.userAccount;
        self.info.member.name    = json.body.userName;

        let images = [];
        switch (json.body.illustType) {
        case 0: // Multi/single images
        case 1:
          const pages_url = `${url}/pages`;
          const pages = JSON.parse(yield AnkUtils.httpGETAsync(pages_url, referer));
          check(pages);
          images = pages.body.map(i => i.urls.original);
          break;

        case 2: // Ugoira
          const meta_url = `${url}/ugoira_meta`;
          const meta = JSON.parse(yield AnkUtils.httpGETAsync(meta_url, referer));
          check(meta);
          images = [meta.body.originalSrc];
          self.info.illust.animationFrames = meta.body.frames.map(o => `${o.file},${o.delay}`);
          break;
        }
        self.info.path.ext = AnkUtils.getFileExtension(images[0]);
        self.info.path.image = {images, facing:null, referer};
        return self.info.path.image;
      });
    },

    /********************************************************************************
     *
     ********************************************************************************/

    /*
     * イラストページにviewerやダウンロードトリガーのインストールを行う
     */
    installMediumPageFunctions: function () {},

    /*
     * リストページのアイテムにダウンロード済みマークなどをつける
     */
    installListPageFunctions: function () {}

  };

  // --------
  global["SiteModule"] = AnkPixivModule;

})(this);
