
import { Express, Request, Response } from "express-serve-static-core";
import * as fs from "fs";
import Config from "../utils/Config";

/**
* Created : 11/09/2020 
*/
export class StorageController {

	private app:Express;
	private static cacheData:any = {};
	private static cachepath:string = Config.UPLOAD_PATH;

	public static ANON_POLLS:string = "ANON_POLLS";
	public static UNIQUE_POLLS:string = "UNIQUE_POLLS";
	public static LANGUAGE:string = "LANGUAGE";
	public static BIRTHDAY_CHANNEL:string = "BIRTHDAY_CHANNEL";
	public static LEAVE_CHANNEL:string = "LEAVE_CHANNEL";
	public static BIRTHDAYS:string = "BIRTHDAYS";
	public static TWITCH_USERS:string = "TWITCH_USERS";
	public static TWITCH_LIVE_CARD:string = "TWITCH_LIVE_CARD";
	public static INACTIVITY_CONFIGS:string = "INACTIVITY_CONFIGS";
	public static SUPPORT_TARGET:string = "SUPPORT_TARGET";
	
	constructor() {
	}
	
	/********************
	* GETTER / SETTERS *
	********************/


	
	
	/******************
	* PUBLIC METHODS *
	******************/
	public async mount(app:Express):Promise<void> {
		this.app = app;
		
		this.app.get("/api/store", (req:Request,res:Response) => this.get(req,res));
	}

	/**
	 * Saves a data to the store
	 * 
	 * @param guildId 
	 * @param key 
	 * @param value 
	 */
	public static setData(guildId:string, key:string, value:any):void {
		if(!StorageController.cacheData[guildId]) {
			StorageController.cacheData[guildId] = {};
		}
		StorageController.cacheData[guildId][key] = value;
		StorageController.saveCache(guildId);
	}

	/**
	 * Gets data from the store 
	 * 
	 * @param guildId 
	 * @param key 
	 * @returns 
	 */
	public static getData(guildId:string, key:string):any {
		if(!StorageController.cacheData[guildId]){
			this.loadCache(guildId);
		}
		return StorageController.cacheData[guildId][key];
	}

	/**
	 * Deletes data from the store
	 * 
	 * @param guildId 
	 * @param key 
	 */
	public static delData(guildId:string, key:string):void {
		delete StorageController.cacheData[guildId][key];
		StorageController.saveCache(guildId);
	}

	/**
	 * Deletes the store
	 * 
	 * @param guildId 
	 */
	public static deleteStore(guildId:string):any {
		let path = this.cachepath + guildId + "/";
		//Create directory structure if not exists
		if(fs.existsSync(path)) {
			fs.rm(path, {recursive:true, force:true}, ()=>{});
		}
	}

	/**
	 * Get all the values for the specified key accross all
	 * storage instances
	 * 
	 * @param key 
	 */
	public static getAllValues(key:string):any[] {
		const files = fs.readdirSync(this.cachepath);
		let result:any[] = [];
		for (let i = 0; i < files.length; i++) {
			const f = files[i];
			if(f == "." || f == "..") continue;
			if(fs.lstatSync(this.cachepath + f).isDirectory())  {
				const data = this.getData(f, key);
				if(data == undefined) continue;

				if(Array.isArray(data)) {
					result = result.concat(data);
				}else{
					result.push(data);
				}
			}
		}
		return result;
	}
	
	
	
	/*******************
	* PRIVATE METHODS *
	*******************/
	private async get(req:Request, res:Response) {
		let key = <string>req.query.key;
		res.status(200).send(JSON.stringify({success:true, value:StorageController.cacheData[key]}));
	}

	private static saveCache(guildId:string):void {
		const path = this.getFilePath(guildId);
		fs.writeFileSync(path, JSON.stringify(this.cacheData[guildId]));
	}
	
	private static loadCache(guildId):void {
		const path = this.getFilePath(guildId);
		let data = fs.readFileSync(path);
		let json;
		try {
			json = JSON.parse(data.toString());
		}catch(e) {
			return;
		}
		this.cacheData[guildId] = json;
	}


	private static getFilePath(guildId:string):string {
		let path = this.cachepath + guildId + "/";
		
		//Create directory structure if not exists
		if(!fs.existsSync(path)) {
			fs.mkdirSync(path, {recursive:true});
		}

		//Create storage file
		path = path+"storage.json"
		if(!fs.existsSync(path)) {
			fs.writeFileSync(path, JSON.stringify({}));
		}

		return path;
	}
}

export interface UniquePoll {
	id:string;
	chan:string;
}

export interface AnonPoll {
	id:string;
	chan:string;
	title:string;
	unique?:boolean;
	opt:AnonPollOption[];
}
export interface AnonPollOption {
	n:string;
	e:string;
	v:string[];
}

export interface TwitchUser {
	uid:string;
	login:string;
	channel:string
}

export interface TwitchLiveMessage {
	messageId:string;
	date:number;
}