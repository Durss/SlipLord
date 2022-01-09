
import { Express, Request, Response } from "express-serve-static-core";
import * as fs from "fs";
import Config from "../utils/Config";

/**
* Created : 11/09/2020 
*/
export class StorageController {

	private app:Express;
	private static cacheData:any = {};
	private static cachepath:string = Config.UPLOAD_PATH+"storage.json";

	public static LIVE_CHANNEL:string = "LIVE_CHANNEL";
	public static ROLES_CHANNEL:string = "ROLES_CHANNEL";
	public static ROLES_EMOJIS:string = "ROLES_EMOJIS";
	public static ROLES_SELECTOR_MESSAGES:string = "ROLES_SELECTOR_MESSAGES";
	
	constructor() {
		if(!fs.existsSync(StorageController.cachepath)) {
			StorageController.saveCache();
		}else{
			StorageController.loadCache();
		}
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

	public static saveData(key:string, value:any):void {
		StorageController.cacheData[key] = value;
		StorageController.saveCache();
	}

	public static getData(key:string):any {
		return StorageController.cacheData[key];
	}
	
	
	
	/*******************
	* PRIVATE METHODS *
	*******************/
	private async get(req:Request, res:Response) {
		let key = <string>req.query.key;
		res.status(200).send(JSON.stringify({success:true, value:StorageController.cacheData[key]}));
	}

	private static saveCache():void {
		fs.writeFileSync(this.cachepath, JSON.stringify(this.cacheData));
	}

	private static loadCache():void {
		let data = fs.readFileSync(this.cachepath);
		let json;
		try {
			json = JSON.parse(data.toString());
		}catch(e) {
			return;
		}
		this.cacheData = json;
	}

}