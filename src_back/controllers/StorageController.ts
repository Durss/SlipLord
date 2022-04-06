
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

	public static LIVE_CHANNEL:string = "LIVE_CHANNEL";
	public static ROLES_CHANNEL:string = "ROLES_CHANNEL";
	public static ANON_POLLS:string = "ANON_POLLS";
	public static LANGUAGE:string = "LANGUAGE";
	public static TWITCH_USERS:string = "TWITCH_USERS";
	
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

	public static saveData(guildId:string, key:string, value:any):void {
		if(!StorageController.cacheData[guildId]) {
			StorageController.cacheData[guildId] = {};
		}
		StorageController.cacheData[guildId][key] = value;
		StorageController.saveCache(guildId);
	}

	public static getData(guildId:string, key:string):any {
		if(!StorageController.cacheData[guildId]){
			this.loadCache(guildId);
		}
		return StorageController.cacheData[guildId][key];
	}

	public static deleteStore(guildId:string):any {
		let path = this.cachepath + guildId + "/";
		//Create directory structure if not exists
		if(fs.existsSync(path)) {
			fs.rm(path, {recursive:true, force:true}, ()=>{});
		}
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