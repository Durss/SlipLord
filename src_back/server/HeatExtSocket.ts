import * as WebSocket from "ws";
import SocketServer, { SOCK_ACTIONS } from "./SocketServer";
import Logger from "../utils/Logger";
import Utils from "../utils/Utils";
import { IUserModel } from "../db/models/user/UserModel";

/**
* Created : 10/07/2021 
*/
export default class HeatExtSocket {

	private static _instance:HeatExtSocket;
	private _socket:WebSocket;
	private _idToTwitchUser:{[key:string]:IUserModel} = {};
	
	constructor() {
	
	}
	
	/********************
	* GETTER / SETTERS *
	********************/
	static get instance():HeatExtSocket {
		if(!HeatExtSocket._instance) {
			HeatExtSocket._instance = new HeatExtSocket();
		}
		return HeatExtSocket._instance;
	}
	
	
	
	/******************
	* PUBLIC METHODS *
	******************/
	public async initialize():Promise<void> {
		this._socket =  new WebSocket('wss://heat-api.j38.net/channel/29961813');
		this._socket.on("error", _=> {
			Logger.error("🔥 HEAT :: on socket ERROR");
		});
		this._socket.on("close", _=> {
			Logger.info("🔥 HEAT :: on socket CLOSE");
			this._socket = null;
			this.initialize();
		});
		this._socket.on("message", async (data:string)=> {
			let json:{type:string, x:number, y:number; id:string, user:IUserModel} = JSON.parse(data);
			if(json.type == "system") {
				Logger.success("🔥 Heat socket connexion succeed");
			}
			let isAnonymous = isNaN(Number(json.id));
			if(!isAnonymous) {
				if(!this._idToTwitchUser[json.id]) {
					let user = await Utils.getUser(json.id);
					this._idToTwitchUser[json.id] = user;
				}
				json.user = this._idToTwitchUser[json.id];
			}
			SocketServer.instance.broadcast({action:SOCK_ACTIONS.HEAT_CLICK, data:json});
		});
	}
	
	
	
	/*******************
	* PRIVATE METHODS *
	*******************/
}