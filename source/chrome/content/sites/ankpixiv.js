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
      get manga () { // {{{
        let v = self.info.path.mangaIndexPage;
        return v && v.match(/(?:&|\?)mode=manga(?:&|$)/);
      }, // }}}

      get ugoira () { // {{{
        let e = self.elements.illust.mediumImage;
        return e && e.tagName.toLowerCase() === 'canvas';
      }, // }}}

      get medium () { // {{{
        let loc = self.info.illust.pageUrl;
        return (
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
        get largeLink () query("._1tR0cJT ._1-h8Se6"),
        get datetime ()  query(".css-d16zpw"),
        get size ()      query('.meta > li+li'), // XXX
        get title ()     query('.css-6njqb8'),
        get comment ()   query('.EG8MDwA p._3nJtUNj'),
        get userName ()  query('.css-cwb1fq'),
        get memberLink ()query('.css-cwb1fq'),
        get tags ()      queryAll('._3SAblVQ > li'),
        get tools ()     query('.tools'), // XXX
        get R18 ()       query('._3SAblVQ a[href*="R-18"]'),
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
        get downloadedDisplayParent () query('._3VLfD7p'),
        get downloadedFilenameArea ()  query('.ank-pixiv-downloaded-filename-text'),

        // require for AnkBase.Viewer
        get body ()         queryAll('body')[0],
        get mediumImage ()  query('._1tR0cJT ._2r_DywD'),
        get bigImage ()     query('._1tR0cJT ._1-h8Se6.r_Q2Jin'),
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
        get size () {
          let e = self.elements.illust.size;
          if (e) {
            let m = e.textContent.match(/(\d+)\xD7(\d+)/);
            if (m)
              return {
                width: parseInt(m[1]),
                height: parseInt(m[2])
              };
          }
        },

        get tags ()
          AnkUtils.A(self.elements.illust.tags)
          .map(e =>AnkUtils.trim(e.textContent))
          .filter(s => s && s.length),

        get shortTags () {
          let limit = AnkBase.Prefs.get('shortTagsMaxLength', 8);
          return illust.tags.filter(it => (it.length <= limit));
        },

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
            if (m)
              return m[1];
          }
        },

        get updated () {
          let e = self.elements.illust.thumbnail;
          return self.decodeUpdated(e && e.getAttribute('data-src'));
        },

        get referer () {
          let mode =
            !self.in.manga                                   ? 'big' :
            !AnkBase.Prefs.get('downloadOriginalSize', true) ? 'manga' :
                                                               'manga_big&page=0'; // @see downloadFiles#downloadNext()

          return self.info.illust.pageUrl.replace(/mode=medium/, 'mode='+mode);
        },

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

        get mangaIndexPage () self.elements.illust.largeLink.href,
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

        // 単ページイラスト(Aパターン)
        if (!self.in.manga) {
          let img = self.elements.illust.bigImage;
          let src = img && (img.getAttribute('data-src') || img.getAttribute('href'));
          if (src)
            return setSelectedImage({ original: { images: [ src ], facing: null, referer: referer } });
          // Bパターンに続く
        }

        // ブック or マンガ or 単ページイラスト(Bパターン)
        return yield Task.spawn(function* () {
          // マンガインデックスページを参照して画像URLリストを取得する
          let indexPage = self.info.path.mangaIndexPage;
          let referer = self.info.illust.pageUrl;
          AnkUtils.dump('MANGA INDEX PAGE: '+indexPage+', '+referer);
          let html = yield AnkUtils.httpGETAsync(indexPage, referer);
          let doc = AnkUtils.createHTMLDocument(html);

          // サーバエラーのトラップ
          if (!doc || doc.querySelector('.errorArea') || doc.querySelector('.errortxt')) {
            throw new Error(AnkBase.Locale.get('serverError'));
          }

          // 単ページイラスト(Bパターン)
          if (!self.in.manga) {
            let img = doc.querySelector('img');
            if (img)
              return setSelectedImage({ original: { images: [ img.src ], facing: null, referer: indexPage } });
            return null;
          }

          // ブック or マンガ
          let thumb = [];
          let orig = [];
          let thumbref = [];
          let origref = [];
          let fp = [];
          if (doc.documentElement.classList.contains('_book-viewer')) {
            // ブック
            // pixivの構成変更で、ページ単位で設定できていた見開き表示が、作品単位でしか設定できなくなったようだ
            function swap (a, i) {
              let tmp = a[i-1];
              a[i-1] = a[i];
              a[i] = tmp;
            }

            let ltr = doc.documentElement.classList.contains('ltr');
            AnkUtils.A(doc.querySelectorAll('script')).forEach(function (e) {
              let mt = e.text.match(/pixiv\.context\.images\[\d+\]\s*=\s*\"(.+?)\"/);
              if (mt) {
                thumb.push(mt[1].replace(/\\(.)/g, '$1'));
              }
              let mo = e.text.match(/pixiv\.context\.originalImages\[\d+\]\s*=\s*\"(.+?)\"/);
              if (mo) {
                orig.push(mo[1].replace(/\\(.)/g, '$1'));
              }
            });
            thumbref = indexPage;
            origref = indexPage;

            for (var i=0; i<thumb.length; i++) {
              let p = i+1;
              if (p == 1) {
                fp.push(p);
              }
              else {
                let oddp = p%2;
                fp.push((p - oddp) / 2 + 1);

                // 見開きの向きに合わせて画像の順番を入れ替える
                if (ltr && oddp) {
                  swap(thumb, i);
                  swap(orig, i);
                }
              }
            }
          }
          else {
            // マンガ
            const MAXPAGE = 1000;

            AnkUtils.A(doc.querySelectorAll('.manga > .item-container > img')).some(function (v) {
              if (thumb.length > MAXPAGE)
                return true;
              thumb.push(v.getAttribute('data-src'));
            });
            thumbref = indexPage;

            if (mangaOriginalSizeCheck) {
              // オリジナル画像
              const reBig = /(_p\d+)\./;
              const replaceBig = '_big$1.';
              const reMaster = /^(https?:\/\/[^/]+).*?\/img-master\/(.+?)_master\d+(\.\w+)$/;
              const replaceMaster = '$1/img-original/$2$3';

              // 個々の画像用に存在するページ
              origref = (function () {
                let uri = Services.io.newURI(indexPage, null, null);
                let base = uri.scheme+'://'+uri.host;
                return AnkUtils.A(doc.querySelectorAll('.manga > .item-container > a')).map(a => base + a.getAttribute('href'));
              })();

              for (let i = 0; i < origref.length && i < thumb.length; i++) {
                AnkUtils.dump('ORIGINAL IMAGE PAGE: '+origref[i]+', '+indexPage);
                let html = yield AnkUtils.httpGETAsync(origref[i], indexPage);
                let doc = AnkUtils.createHTMLDocument(html);

                // サーバエラーのトラップ
                if (!doc || doc.querySelector('.errorArea') || doc.querySelector('.errortxt')) {
                  throw new Error(AnkBase.Locale.get('serverError'));
                }

                let src = doc.querySelector('img').src;

                if (!AnkBase.Prefs.get('forceCheckMangaImagesAll', false)) {
                  // 最初の一枚以外は拡張子チェックを行わないモード
                  if (thumb[0] == src) {
                    AnkUtils.dump('MANGA IMAGE: plane mode');
                    orig = thumb.map(v => v);
                  }
                  else if (thumb[0].replace(reMaster, replaceMaster).replace(/\.\w+$/, '') == src.replace(/(\.\w+)$/, '')) {
                    // FIXME
                    let replaceExt = RegExp.$1;
                    AnkUtils.dump('MANGA IMAGE: master mode ... '+thumb[0]+' -> '+thumb[0].replace(reMaster, replaceMaster).replace(/\.\w+$/, replaceExt));
                    orig = thumb.map(v => v.replace(reMaster, replaceMaster).replace(/\.\w+$/, replaceExt));
                  }
                  else if (thumb[0].replace(reBig, replaceBig) == src) {
                    AnkUtils.dump('MANGA IMAGE: big mode ... '+thumb[0]+' -> '+thumb[0].replace(reBig, replaceBig));
                    orig = thumb.map(v => v.replace(reBig, replaceBig));
                  }
                  else {
                    AnkUtils.dump('MANGA IMAGE: UNKNOWN MODE ... '+thumb[0]+' -> '+src);
                  }

                  break;
                }

                orig.push(src);
              }
            }
          }

          if (thumb.length > 0) {
            if (fp.length > 0 && fp[fp.length - 1] < fp.length) {
              // 見開きがある場合
              AnkUtils.dump("Facing Page Check: (thumb) " + thumb.length + ", (orig) "+orig.length+" pics in " + fp[fp.length - 1] + " pages");
            }
            else {
              // 見開きがない場合
              AnkUtils.dump("Facing Page Check: (thumb) " + thumb.length + ", (orig) "+orig.length+" pics");
              fp = null;
            }

            return setSelectedImage({
              thumbnail:{ images: thumb, facing: fp, referer: thumbref },
              original: { images: orig,  facing: fp, referer: origref }
            });
          }

          // error
          return null;
        });
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
        var largeLink = self.elements.illust.largeLink;
        var openCaption = self.elements.illust.openCaption;
        var imgOvr = self.elements.illust.imageOverlay;

        // 完全に読み込まれていないっぽいときは、遅延する
        if (!(body && medImg && imgOvr)) { // {{{
          return false;   // リトライしてほしい
        } // }}}

        let createDebugMessageArea = function () {
          let e = self.elements.illust.uiLayoutWest;
          if (e) {
            {
              let div = doc.createElement('div');
              div.classList.add('area_new');
              div.classList.add('ank-pixiv-downloaded-filename');

              let dtitle = doc.createElement('div');
              dtitle.classList.add('area_title');
              dtitle.classList.add('ank-pixiv-downloaded-filename-title');
              div.appendChild(dtitle);

              let dcaption = doc.createElement('div');
              dcaption.classList.add('area_inside');
              dcaption.classList.add('ank-pixiv-downloaded-filename-text');
              div.appendChild(dcaption);

              e.insertBefore(div, e.querySelector('.profile-unit+*'));
            }
          }
        };

        let addMiddleClickEventListener = function () {
          if (useViewer)
            self.viewer = new AnkBase.Viewer(self);

          let useCapture = !self.in.ugoira && useViewer;

          // FIXME AnkBase.Viewer無効時に、中クリックして、Pixivのデフォルト動作で大画像を見ると、ダウンロードマークが消える
          // FIXME imgOvrの方になった場合は、medImgより広い領域がクリック可能となるが、jQuery.on('click')を無効化できないため止む無し
          (largeLink || imgOvr).addEventListener(
            'click',
            function (e) {
              Task.spawn(function () {
                // mangaIndexPageへのアクセスが複数回実行されないように、getImageUrlAsync()を一度実行してからopenViewer()とdownloadCurrentImageAuto()を順次実行する
                let image = yield self.getImageUrlAsync(useOriginalSize);
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

        let addRatingEventListener = function () {
          let point = AnkBase.Prefs.get('downloadRate', 10);
          AnkUtils.A(doc.querySelectorAll('.rating')).forEach(function (e) {
            e.addEventListener(
              'click',
              function () {
                let klass = e.getAttribute('class', '');
                let m = klass.match(/rate-(\d+)/);
                if (m && (point <= parseInt(m[1], 10)))
                  AnkBase.downloadCurrentImageAuto(self);
              },
              true
            );
          });
        };

        // デバッグ用
        if (AnkBase.Prefs.get('showDownloadedFilename', false))
          createDebugMessageArea();

        // 中画像クリック
        var useViewer = !self.in.ugoira && AnkBase.Prefs.get('largeOnMiddle', true) && AnkBase.Prefs.get('largeOnMiddle.'+self.SITE_NAME, true);
        var useClickDownload = AnkBase.Prefs.get('downloadWhenClickMiddle', false);
        var useOriginalSize = useViewer        && AnkBase.Prefs.get('viewOriginalSize', false) ||
                              useClickDownload && AnkBase.Prefs.get('downloadOriginalSize', false);
        if (useViewer || useClickDownload)
          addMiddleClickEventListener();

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
