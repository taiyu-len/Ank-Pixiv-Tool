"use strict";

Components.utils.import("resource://gre/modules/Task.jsm");

(function (global) {

  function AnkPixivModule(doc) {
    var self = this;

    self.curdoc = doc;
    self.viewer;
    self.marked = false;
    self._functionsInstalled = false;

    /********************************************************************************
    * プロパティ
    ********************************************************************************/

    self.in = {
      manga: true,
      get medium() { return !!self.getIllustId(); },
      get illustPage() { return !!self.getIllustId(); }
    };

    self.elements = {
      illust: {
        get body() { return self.curdoc.querySelectorAll('body')[0]; },
        ads:[]
      },
      get doc() { return self.curdoc; }
    };

    self.info = {
      illust: {
        get id() { return self.getIllustId(); },
        get pageUrl() { return self.curdoc.location.href; },
        get referer() { return self.info.illust.pageUrl; },

        // set by getImageUrlAsync function
        comment: undefined, // tweet text
        dateTime: undefined,
        mangaPages: undefined,
        R18:undefined,

        // empty
        height: 0,
        server: null,
        shortTags: [],
        size: null,
        tags: [],
        title: "",
        tools: [],
        width: 0,
        worksData: null
      },
      member: {
        // set by getImageUrlAsync function
        id: undefined, // id_str
        pixivId: undefined, // screen_name
        name:undefined, // name

        // not set
        memoizedName: null
      },
      path: {
        get initDir () {
          return AnkBase.Prefs.get('initialDirectory.' + self.SITE_NAME);
        },
        // set by getImageUrlAsync function
        image: undefined,
        ext: ".jpg"
      }
    };
  }


  AnkPixivModule.prototype = {

    /********************************************************************************
     * 定数
     ********************************************************************************/

    URL:        'https://twitter.com/', // イラストページ以外でボタンを押したときに開くトップページのURL
    DOMAIN:     'twitter.com',          // CSSの適用対象となるドメイン
    SERVICE_ID: 'TWT',                  // 履歴DBに登録するサイト識別子
    SITE_NAME:  'Twitter',              // ?site-name?で置換されるサイト名のデフォルト値

    /********************************************************************************
     * 
     ********************************************************************************/

    /**
     * このモジュールの対応サイトかどうか
     */
    isSupported: function (doc) {
      return doc.location.href.match(/^https?:\/\/twitter\.com\//) &&
            !doc.location.href.match(/^https?:\/\/pic\.twitter\.com\//);
    },

    /**
     * ファンクションのインストール
     */
    initFunctions: function () {
      if (this._functionsInstalled)
        return;

      var self = this;
      var doc = this.curdoc;

      this._functionsInstalled = true;
      return;
      /*
      if (self.in.medium) {
        self.installMediumPageFunctions();
      }
      else {
        self.installListPageFunctions();
      }*/
    },

    /**
     * ダウンロード可能か
     */
    isDownloadable: function () {
      if (this.getIllustId())
        return { illust_id:this.getIllustId(), service_id:this.SERVICE_ID };
    },

    /**
     * イラストID
     */
    getIllustId: function () {
      let id = this.info.illust.pageUrl.match(/status\/(\d+)/);
      return id && id[1];
    },

    // FIXME イベント発火→ダウンロード開始の間にギャラリー移動があると目的のもと違う画像がダウンロードされる問題がある

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
    markDownloaded: function (node, force, ignorePref) { // {{{
      const IsIllust = /^https?:\/\/(?:pbs\.twimg\.com\/media|t\.co)\/([^/]+?)(?:$|\.)/;
      const Targets = [
                        ['span.media-thumbnail > img', 1],  // thumbnail
                        ['div.cards-multimedia > a.media-thumbnail > div > img', 3],  // photo (list/tweet)
                        ['.original-tweet div.cards-multimedia > div.multi-photos > div.photo-1 > img', 3],  // multi-photo (list)
                        ['.js-original-tweet div.cards-multimedia > div.multi-photos > div.photo-1 > img', 3],  // multi-photo (tweet)
                        ['.TwitterPhoto a.TwitterPhoto-link > img', 2], // photo (media)
                        ['.TwitterMultiPhoto div.TwitterMultiPhoto-image--1 > img', 2], // multi-photo (media)
                      ];

      return AnkBase.markDownloaded(IsIllust, Targets, 2, this, node, force, ignorePref);
    }, // }}}

    /*
     * 評価
     */
    setRating: () => true,

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
        const illust_id = self.getIllustId();
        const authorization = "Bearer " +
          "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs" +
          "%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
        const cookies = self.curdoc.cookie;

        // get x-csrf-token from cookie required to make api request.
        const csrf_token = (() => {
          let m = cookies.match(/ct0=(.*?)(?:;|$)/);
          if (m) return m[1];
          else throw new Error(`${url}:unable to find csrf token in cookies`);
        })();

        // get x-guest-token from cookie if it exists
        const guest_token = (() => {
          let m = cookies.match(/gt=(.*?)(?:;|$)/);
          return m && m[1];
        })();

        // build extra headers required for using api.
        const authtype = guest_token ? "x-guest-token" : "x-twitter-auth-type";
        const authval  = guest_token ?    guest_token  : "OAuth2Session";
        const headers = {
          authorization,
          "x-csrf-token": csrf_token,
          [authtype]: authval
        };

        // make request
        // The options used by the browser client are the following.
        // the one we need to get access to the media entries is.
        // `tweet_mode=extended`
        //
        // include_profile_interstitial_type=1
        // include_blocking=1
        // include_blocked_by=1
        // include_followed_by=1
        // include_want_retweets=1
        // include_mute_edge=1
        // include_can_dm=1
        // include_can_media_tag=1
        // skip_status=1
        // cards_platform=Web-12
        // include_cards=1
        // include_composer_source=true
        // include_ext_alt_text=true
        // include_reply_count=1
        // tweet_mode=extended
        // include_entities=true
        // include_user_entities=true
        // include_ext_media_color=true
        // include_ext_media_availability=true
        // send_error_codes=true
        // simple_quoted_tweet=true
        // count=20
        // ext=mediaStats%2ChighlightedLabel%2CcameraMoment
        // include_quote_count=true
        const url = `https://api.twitter.com/2/timeline/conversation/${illust_id}.json?tweet_mode=extended`;
        const json = JSON.parse(yield AnkUtils.httpGETAsync(url, referer, headers));

        if (json.errors)
          throw new Error(`${url}:${JSON.stringify(json.errors)}`);
        const tweet = json.globalObjects.tweets[illust_id];
        const user  = json.globalObjects.users[tweet.user_id_str];

        self.info.illust.comment    = tweet.text;
        self.info.illust.dateTime   = AnkUtils.getDecodedDateTime(new Date(tweet.created_at));
        self.info.illust.mangaPages = tweet.entities.media.length;
        self.info.illust.R18        = tweet.possibly_sensitive;

        self.info.member.id      = user.id_str;
        self.info.member.pixivId = user.screen_name;
        self.info.member.name    = user.name;

        // video
        try {
          // select highest bitrate video
          function select_best(best, cur) { return cur.bitrate > best.bitrate ? cur : best; }
          function invalid(val)   { return !!val.bitrate; }
          const variants = tweet.extended_entities.media.video_info.variants;
          const selected = variants.filter(invalid).reduce(select_best);
          const images   = [selected.url];
          self.info.path.ext   = ".mp4";
          self.info.path.image = {images, facing:null, referer};
          return self.info.path.image;
        } catch (e) {};

        // regular images
        try {
          const images = tweet.entities.media.map(i => i.media_url_https + ":orig");
          self.info.path.image = {images, facing:null, referer};
          return self.info.path.image;
        } catch (e) {};

        // no image found
        return {images:[], facing:null, referer};
      });
    },

    /********************************************************************************
     *
     ********************************************************************************/

    /*
     * イラストページにviewerやダウンロードトリガーのインストールを行う
     */
    installMediumPageFunctions: function () { // {{{
      var self = this;
      var doc = this.curdoc;

      let proc = function () { // {{{
        // インストールに必用な各種要素
        var body = self.elements.illust.body;
        var medImg = self.elements.illust.mediumImage;
        var largeLink = self.elements.illust.largeLink;
        var photoFrame = self.in.tweet ? self.elements.illust.photoFrame : null;
        var videoFrame = self.in.tweet ? self.elements.illust.videoFrame : null;

        // 完全に読み込まれていないっぽいときは、遅延する
        let cond = (function () {
          if (videoFrame)
            return self.elements.illust.videoContent;
          if (photoFrame)
            return medImg && self.elements.illust.photoImage;
          return medImg && largeLink;
        })();

        if (!(body && cond)) {
          return false;   // リトライしてほしい
        }

        function createDebugMessageArea() {
          if (doc.querySelector('.ank-pixiv-downloaded-filename'))
            return;

          let e = doc.querySelector('.opened-tweet.permalink-tweet .client-and-actions');
          if (e) {
            {
              let div = doc.createElement('div');
              div.classList.add('ank-pixiv-downloaded-filename');
              let dcaption = doc.createElement('div');
              dcaption.classList.add('ank-pixiv-downloaded-filename-text');
              div.appendChild(dcaption);

              e.appendChild(div);
            }
          }
        }

        function addMiddleClickEventListener () {
          if (useViewer)
            self.viewer = new AnkBase.Viewer(self);
          medImg.addEventListener(
            'click',
            function (e) {
              Task.spawn(function *() {
                // mangaIndexPageへのアクセスが複数回実行されないように、getImageUrlAsync()を一度実行してからopenViewer()とdownloadCurrentImageAuto()を順次実行する
                let image = yield self.getImageUrlAsync();
                if (!image || image.images.length == 0) {
                  window.alert(AnkBase.Locale.get('cannotFindImages'));
                  return;
                }

                if (useViewer)
                  self.viewer.openViewer();
                if (useClickDownload)
                  AnkBase.downloadCurrentImageAuto(self);
              }).catch(e => AnkUtils.dumpError(e,true));

              e.preventDefault();
              e.stopPropagation();
            },
            true
          );
        }

        // デバッグ用
        if (AnkBase.Prefs.get('showDownloadedFilename', false))
          createDebugMessageArea();

        // 中画像クリック時に保存する
        let useViewer = AnkBase.Prefs.get('largeOnMiddle', true) && AnkBase.Prefs.get('largeOnMiddle.'+self.SITE_NAME, true);
        let useClickDownload = AnkBase.Prefs.get('downloadWhenClickMiddle', false);
        if (medImg && (useViewer || useClickDownload))
          addMiddleClickEventListener();

        // 保存済み表示（ギャラリー）
        AnkBase.insertDownloadedDisplayById(
          self.elements.illust.downloadedDisplayParent,
          self.info.illust.R18,
          self.info.illust.id,
          self.SERVICE_ID
        );

        // 保存済み表示（ツイート）
        self.markDownloaded(doc,true);

        return true;
      }; // }}}

      // install now
      return AnkBase.delayFunctionInstaller(proc, 500, 60, self.SITE_NAME, '');
    }, // }}}

    /*
     * リストページ用ファンクション
     */
    installListPageFunctions: function () { // {{{
      var self = this;
      var doc = this.curdoc;

      let followExpansion = function () {
        let newGrid = self.elements.doc.querySelector('.AppContent-main .GridTimeline-items');
        let grid = self.elements.doc.querySelector('.stream-media-grid-items');
        let items = self.elements.doc.querySelector('.stream-items');

        let elm = grid || items || newGrid;
        if (!elm) {
          return false;     // リトライしてほしい
        }

        // 伸びるおすすめリストに追随する
        if (MutationObserver) {
          new MutationObserver(function (o) {
            o.forEach(e =>self.markDownloaded(e.target, true));
          }).observe(elm, {childList: true});
        }

        return true;
      };

      let delayMarking = function () {
        if (typeof doc === 'undefined' || !doc || doc.readyState !== "complete") {
          return false;     // リトライしてほしい
        }

        self.markDownloaded(doc,true);

        return true;
      };

      // install now
      if (AnkBase.Prefs.get('markDownloaded', false)) {
        AnkBase.delayFunctionInstaller(followExpansion, 500, 20, self.SITE_NAME, 'followExpansion');
        AnkBase.delayFunctionInstaller(delayMarking, 500, 20, self.SITE_NAME, 'delayMarking');
      }
    } // }}}
  };

  // --------
  global["SiteModule"] = AnkPixivModule;

})(this);
