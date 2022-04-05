import * as fs from "fs";
import Config from "./Config";

/**
* Created : 05/04/2022 
*/
export default class Label {

	private static labels:Locale;
	private static locale:AvailableLocales;
	
	constructor() {
	}
	
	/********************
	* GETTER / SETTERS *
	********************/
	
	
	
	/******************
	* PUBLIC METHODS *
	******************/
	public static async initialize():Promise<void> {
		let data = fs.readFileSync(Config.LABELS_PATH);
		let json;
		try {
			json = JSON.parse(data.toString());
		}catch(e) {
			console.log(e);
			return;
		}
		this.labels = json;
	}

	public static setLocale(locale:AvailableLocales):void {
		this.locale = locale;
	}

	/**
	 * Gets a label by its path on the file "labels.json"
	 * 
	 * @param path 
	 * @param replace replaces all "{id}" occurrences by the "text" value
	 * @returns 
	 */
	public static get(path:string, replace?:{id:string, text:string}):string {
		const chunks = path.split(".");
		let result;
		try {
			result = this.labels[this.locale];
			for (let i = 0; i < chunks.length; i++) {
				result = result[chunks[i]];
			}
		}catch(error) {
			// console.log(error);
			return "Label not found at path: "+this.locale+"."+path;
		}
		if(replace?.id&& replace?.text) {
			result = result.replace(new RegExp("{"+replace.id+"}", "gi"), replace.text);
		}
		return result;
	}
	
	
	
	/*******************
	* PRIVATE METHODS *
	*******************/
}

export type AvailableLocales = "en" | "fr";

interface Locale {
	fr:{[key:string]:string};
	en:{[key:string]:string};
}