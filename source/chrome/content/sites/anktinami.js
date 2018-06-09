"use strict";

Components.utils.import("resource://gre/modules/Task.jsm");

(function (global) {

  let AnkPixivModule = function (doc) {

    var self = this;

    self.curdoc = doc;

    self.viewer;

    self.marked = false;

    self._functionsInstalled = false;

    self._image;

    /********************************************************************************
    * プロパティ
    ********************************************************************************/

    self.in = { // {{{
      get manga () { // {{{
        return (self.info.illust.mangaPages > 1);
      }, // }}}

      get medium () { // {{{
        return self.in.illustPage;
      }, // }}}

      get illustPage () { // {{{
        return self.info.illust.pageUrl.match(/^https?:\/\/www\.tinami\.com\/view\//);
      } // }}}
    }; // }}}

    self.elements = (function () { // {{{
      function query (q) {
        return self.elements.doc.querySelector(q);
      }

      function queryAll (q) {
        return self.elements.doc.querySelectorAll(q);
      }

      let illust =  {
        get images () {
          let e = query('.captify')
          if (e)
            return [e];
          return queryAll('.viewbody img');
        },

        get datetime () {
          return query('.view_info');
        },

        get title () {
          return query('.viewdata > h1 > span');
        },

        get comment () {
          return query('.description');
        },

        get userName () {
          return query('.prof > p > a > strong');
        },

        get memberLink () {
          return query('.prof > p > a');
        },

        get tags () {
          return queryAll('.tag > span');
        },

        get typeImages () {
          return queryAll('.viewdata > p > img');
        },

        get postParams () {
          return queryAll('#open_original_content > input');
        },

        get nextLink() {
          return query('.mvnext > a');
        },

        get prevLink() {
          return query('.mvprev > a');
        },

        // require for AnkBase

        get downloadedDisplayParent () {
          return query('.description');
        },

        // require for AnkBase.Viewer

        get body () {
          let e = queryAll('body');
          if (e)
            return e.length > 0 && e[0];
        },

        get wrapper () {
          return query('#container');
        },

        get mediumImage () {
          return illust.images[0];
        },

        get imageOverlay () {
          return query('.viewbody');
        },

        get largeForm () {
          return query('#open_original_content');
        },

        get openCaption () {
          return query('#show_all');
        },

        get ads () {
          let header = query('#header');
          let controller = query('#controller');

          return ([]).concat(header, controller);
        }
      };

      return {
        illust: illust,
        get doc () {
          return self.curdoc;
        }
      };
    })(); // }}}

    self.info = (function () { // {{{
      let illust = {
        get pageUrl () {
          return self.elements.doc.location.href;
        },

        get id () {
          return self.getIllustId();
        },

        get dateTime () {
          return AnkUtils.decodeDateTimeText(self.elements.illust.datetime.textContent);
        },

        get size () {
          return null;
        },

        get tags () {
          return AnkUtils.A(self.elements.illust.tags).filter(e => AnkUtils.trim(e.textContent));
        },

        get shortTags () {
          let limit = AnkBase.Prefs.get('shortTagsMaxLength', 8);
          return self.info.illust.tags.filter(it => (it.length <= limit));
        },

        get tools () {
          return null;
        },

        get width () {
          return 0;
        },

        get height () {
          return 0;
        },

        get server () {
          return null;
        },

        get referer () {
          return self.info.illust.pageUrl;
        },

        get title () {
          return AnkUtils.trim(self.elements.illust.title.textContent);
        },

        get comment () {
          return AnkUtils.trim(self.elements.illust.comment.textContent);
        },

        get R18 () {
          return false;
        },

        get mangaPages () {
          return self.info.path.image.images.length;
        }
      };

      let member = {
        get id () {
          return self.elements.illust.memberLink.href.match(/\/profile\/(.+)(?:\?|$)/)[1];
        },

        get pixivId () {
          return member.id;
        },

        get name () {
          return AnkUtils.trim(self.elements.illust.userName.textContent);
        },

        get memoizedName () {
          return null;
        }
      };

      let path = {
        get initDir () {
          return AnkBase.Prefs.get('initialDirectory.' + self.SITE_NAME);
        },

        get ext () {
          return AnkUtils.getFileExtension(path.image.images.length > 0 && path.image.images[0]);
        },

        get mangaIndexPage () {
          return null;
        },

        get image () {
          return self._image;
        }
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

     URL:        'http://www.tinami.com/', // イラストページ以外でボタンを押したときに開くトップページのURL
     DOMAIN:     'tinami.com',             // CSSの適用対象となるドメイン
     SERVICE_ID: 'TNM',                    // 履歴DBに登録するサイト識別子
     SITE_NAME:  'Tinami',                 // ?site-name?で置換されるサイト名のデフォルト値

     /********************************************************************************
      * 
      ********************************************************************************/

     /**
      * このモジュールの対応サイトかどうか
      */
     isSupported: function (doc) {
       return doc.location.href.match(/^https?:\/\/[^/]*tinami\.com\//);
     },

     /**
      * ファンクションのインストール
      */
     initFunctions: function () {
       if (this._functionsInstalled)
         return;

       this._functionsInstalled = true;

       if (this.in.medium) {
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

       if (this.in.medium)
         return { illust_id:this.getIllustId(), service_id:this.SERVICE_ID };
     },

     /**
      * イラストID
      */
     getIllustId: function () {
       let m = this.curdoc.location.href.match(/www\.tinami\.com\/view\/([^/]+?)(?:\?|$)/);
       return m && parseInt(m[1], 10);
     },

     /**
      * ダウンロード実行
      */
     downloadCurrentImage: function (useDialog, debug) {
       let self = this;
       Task.spawn(function () {
         let image = yield self.getImageUrlAsync();
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
       const IsIllust = /\/([^/]+?)(?:\?|$)/;
       const Targets = [
                         ['td > p.capt + a', 1],                              // 一覧
                         ['td > .title > .collection_form_checkbox + a', 2],  // コレクション
                         ['.thumbs > li > ul > li > a', 1],                   // 最近の投稿作品
                       ];

       return AnkBase.markDownloaded(IsIllust, Targets, false, this, node, force, ignorePref);
     }, // }}}

     /*
      * 評価する
      */
     setRating: function () { // {{{
       return true;
     },

     /********************************************************************************
      * 
      ********************************************************************************/

     /**
      * 画像URLリストの取得
      */
     getImageUrlAsync: function () {

       let self = this;

       return Task.spawn(function* () {

         // 取得済みならそのまま返す
         if (self._image && self._image.images.length > 0)
           return self._image;

         function setSelectedImage (image) {
           self._image = image;
           return image;
         }

         let m = []

         // マンガ
         if (!self.elements.illust.largeForm) {
           m = AnkUtils.A(self.elements.illust.images).map(e => e.src);
         }
         else {
           // イラスト
           let params = AnkUtils.A(self.elements.illust.postParams).
                          map(e => (e.getAttribute('name')+'='+e.getAttribute('value'))).
                            join('&');
           let html = yield AnkUtils.httpGETAsync(self.info.illust.pageUrl, self.info.illust.pageUrl, params);
           let doc = AnkUtils.createHTMLDocument(html);
           if (!doc)
             return null;

           m = Array.slice(doc.querySelectorAll('img')).
                 filter(e => e.src.match(/^https?:\/\/img\.tinami\.com\/illust\d*\/img\//)).
                   map(e => e.src);
         }

         return setSelectedImage({ images: m, facing: null });
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
        var body = self.elements.illust.body;
        var wrapper = self.elements.illust.wrapper;
        var medImg = self.elements.illust.mediumImage;
        var openCaption = self.elements.illust.openCaption;
        var images = self.elements.illust.images;
        var imgOvr = self.elements.illust.imageOverlay;

        if (!(body && wrapper && (images && images.length>0) && medImg && imgOvr)) {
          return false;   // リトライしてほしい
        }

        let addMiddleClickEventListener = function () {
          if (useViewer)
            self.viewer = new AnkBase.Viewer(self);

          let useCapture = useViewer;

          imgOvr.addEventListener(
            'click',
            function (e) {
              Task.spawn(function () {
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

              if (useCapture) {
                e.preventDefault();
                e.stopPropagation();
              }
            },
            useCapture
          );
        };

        // 中画像クリック
        let useViewer = AnkBase.Prefs.get('largeOnMiddle', true) && AnkBase.Prefs.get('largeOnMiddle.'+self.SITE_NAME, true);
        let useClickDownload = AnkBase.Prefs.get('downloadWhenClickMiddle', false);
        if (useViewer || useClickDownload)
          addMiddleClickEventListener();

        // 保存済み表示
        AnkBase.insertDownloadedDisplayById(
          self.elements.illust.downloadedDisplayParent,
          self.info.illust.R18,
          self.info.illust.id,
          self.SERVICE_ID
        );

        // 続きを表示
        if (AnkBase.Prefs.get('openCaption', false) && openCaption)
          setTimeout(() => openCaption.click(), 1000);

        return true;
      };

      var self = this;
      var doc = this.curdoc;

      // install now
      return AnkBase.delayFunctionInstaller(proc, 500, 40, self.SITE_NAME, '');
    }, // }}}

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
    } // }}}

  };

   // --------
   global["SiteModule"] = AnkPixivModule;

 })(this);
