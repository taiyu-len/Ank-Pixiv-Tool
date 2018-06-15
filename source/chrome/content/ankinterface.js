"use strict";

/********************************************************************************
 * 外部向け - 他拡張と連携して処理を行う
 ********************************************************************************/
var AnkPixiv = {
	downloadCurrentImage() {
		return AnkBase.expose.downloadCurrentImage();
	},
	rate() {
		return AnkBase.expose.rate();
	}
};

