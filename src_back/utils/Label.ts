import * as fs from "fs";
import Config from "./Config";

/**
* Created : 05/04/2022 
*/
export default class Label {

	private static labels:Locale;
	
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

	/**
	 * Get available locales
	 * @returns 
	 */
	public static getLocales():{id:string,name:string}[] {
		const ids = Object.keys(this.labels);
		return ids.map((id) => {
			return {
				id,
				name:this.labels[id].language
			}
		});
	}

	/**
	 * Gets a label by its path on the file "labels.json"
	 * 
	 * @param path 
	 * @param replacements replaces all "{id}" occurrences by the "text" value
	 * @returns 
	 */
	public static get(locale:string, path:string, replacements?:{id:string, value:string}[]):string {
		const chunks = path.split(".");
		let result;
		try {
			result = this.labels[locale];
			for (let i = 0; i < chunks.length; i++) {
				result = result[chunks[i]];
			}
		}catch(error) {
			// console.log(error);
			return "Label not found at path: "+locale+"."+path+" for locale "+locale;
		}
		if(replacements && replacements.length > 0) {
			for (let i = 0; i < replacements.length; i++) {
				const replacement = replacements[i];
				if(replacement?.id && replacement?.value) {
					result = result.replace(new RegExp("{"+replacement.id+"}", "gi"), replacement.value);
				}
			}
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