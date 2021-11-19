import { HmacSHA256 } from "crypto-js";
import { Express, Request, Response } from "express-serve-static-core";
import Config from "../utils/Config";
import Logger, { LogStyle } from '../utils/Logger';
import TwitchUtils from "../utils/TwitchUtils";
import fetch from "node-fetch";
import { Event, EventDispatcher } from "../utils/EventDispatcher";

/**
* Created : 25/10/2021 
*/
export default class EventSubController extends EventDispatcher {

	private app:Express;
	private url:string=null;
	private token:string=null;
	private idsParsed:{[key:string]:boolean} = {};
	private lastUserAlert:{[key:string]:number} = {};
	private challengeCompleteCount:number = 0;
	private challengeCompleteLogTimeout:any;
	private subToList:string[] = [];
	
	constructor() {
		super();
	}
	
	/********************
	* GETTER / SETTERS *
	********************/
	
	
	
	/******************
	* PUBLIC METHODS *
	******************/
	public async mount(app:Express, callbackUrl?:string):Promise<void> {
		this.app = app;
		this.app.post("/api/eventsubcallback", (req:Request,res:Response) => this.eventSub(req,res));
		
		if(!callbackUrl) {
			callbackUrl = Config.PUBLIC_SECURED_URL;
		}
		this.url = callbackUrl.replace(/\/+$/gi, "")+"/";
		
		if(this.url) {
			this.token = await TwitchUtils.getClientCredentialToken();
			await this.unsubPrevious();
			// await this.subToUser("647389082");
			this.onReady();
		}
	}

	/**
	 * Requests to receive live notifications for a specific user
	 * 
	 * @param uid	twitch user ID 
	 */
	public async subToUser(uid:string):Promise<void> {
		if(!this.url) {
			Logger.warn("📢 EventSub is missing a callback URI to be initialized !");
			return;
		}
		if(!Config.TWITCH_EVENTSUB_SECRET) {
			Logger.warn("📢 EventSub is missing a secret passphrase to be initialized !");
			return;
		}
		let condition:any = {
			"broadcaster_user_id": uid
		};

		this.token = await TwitchUtils.getClientCredentialToken();

		let opts = {
			method:"POST",
			headers:{
				"Client-ID": Config.TWITCH_APP_CLIENT_ID,
				"Authorization": "Bearer "+this.token,
				"Content-Type": "application/json",
			},
			body:JSON.stringify({
				"type": "stream.online",
				"version": "1",
				"condition": condition,
				"transport": {
					"method": "webhook",
					"callback": this.url+"api/eventsubcallback",
					"secret": Config.TWITCH_EVENTSUB_SECRET,
				}
			})
		}
		
		try {
			let res = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", opts);
			if(res.status == 403) {
				this.logOAuthURL();
				return;
			}
			// console.log(await res.json());
		}catch(error) {
			Logger.error("📢 EventSub subscription error for user:", uid);
			console.log(error);
			//Try again
			setTimeout(() => this.subToUser(uid), 10000);
			return;
		}

		this.subToList.push(uid);
		clearTimeout(this.challengeCompleteLogTimeout);
		this.challengeCompleteLogTimeout = setTimeout(_=> {
			Logger.success("📢 EventSub subscribed to "+this.subToList.length+" users :",this.subToList);
			this.subToList = [];
		}, 500);
	}

	/**
	 * Stops receiving live notifications for a specific user
	 * 
	 * @param profile 
	 * @param uid 
	 */
	public unsubUser(profile:string, uid:string):void {
		this.unsubPrevious(profile, uid);
	}


	
	
	/*******************
	* PRIVATE METHODS *
	*******************/
	private async onReady():Promise<void> {
		Logger.success("📢 EventSub ready");
	}

	/**
	 * Called when receiving an event
	 * 
	 * @param req 
	 * @param res 
	 * @returns 
	 */
	private async eventSub(req:Request, res:Response):Promise<void> {
		let json:EventSubMessage = <EventSubMessage>req.body;
		let id = <string>req.headers["twitch-eventsub-message-id"];
		let data = req.body.event;

		//Filter out IDs already parsed
		if(this.idsParsed[id] === true) {
			// console.log("Ignore", id);
			res.status(200);
			return;
		}

		if(json.subscription.status == "webhook_callback_verification_pending") {
			//Challenging EventSub signature
			let sig = <string>req.headers["twitch-eventsub-message-signature"];
			let ts = <string>req.headers["twitch-eventsub-message-timestamp"];
			let hash = "sha256="+HmacSHA256(id+ts+JSON.stringify(req.body), Config.TWITCH_EVENTSUB_SECRET).toString();
			if(hash != sig) {
				Logger.error("📢 Invalid signature challenge");
				res.status(401);
				return;
			}
			this.challengeCompleteCount ++;
			clearTimeout(this.challengeCompleteLogTimeout);
			this.challengeCompleteLogTimeout = setTimeout(_=> {
				Logger.success("📢 EventSub challenge completed for "+this.challengeCompleteCount+" events");
				this.challengeCompleteCount = 0;
			}, 500);

			res.status(200).send(req.body.challenge);
			return;

		}else{
			if(data.type == "live") {
				Logger.info("📢 The channel "+data.broadcaster_user_name+" went live at "+data.started_at+" with type "+data.type);
				let uid = data.broadcaster_user_id;
				let lastAlert = this.lastUserAlert[uid] || 999999;
				//Alert only once every 30min
				if(Date.now() - lastAlert > 1000 * 60 * 30) {
					this.lastUserAlert[uid] = Date.now();
					this.dispatchEvent(new Event(Event.DISCORD_ALERT_LIVE, uid));
				}
			}
		}
		this.idsParsed[id] = true;
		res.sendStatus(200);
	}
	/**
	 * Removes previous event sub
	 * 
	 * @param uid	specify a user ID to remove a specific event sub
	 * @returns 
	 */
	private async unsubPrevious(profile?:string, uid?:string):Promise<void> {
		this.token = await TwitchUtils.getClientCredentialToken();
		let opts = {
			method:"GET",
			headers:{
				"Client-ID": Config.TWITCH_APP_CLIENT_ID,
				"Authorization": "Bearer "+this.token,
				"Content-Type": "application/json",
			}
		};
		let list:EventSubMessageSubType.Subscription[] = [];
		let json:any, cursor:string;
		do {
			let url = "https://api.twitch.tv/helix/eventsub/subscriptions";
			if(cursor) {
				url += "?after="+cursor;
			}
			// console.log(url);
			let res = await fetch(url, opts);
			json = await res.json();
			if(res.status == 401) {
				this.logOAuthURL();
				return;
			}
			list = list.concat(json.data);
			cursor = json.pagination?.cursor;
		}while(cursor != null);

		// console.log(json.total_cost);
		// console.log(json.max_total_cost);
		// console.log(json.pagination);
		// console.log(json.data.length+" / "+json.total);
		// console.log("LOADED COUNT ", list.length);
		

		//Filtering out only callbacks for current environment
		let callbacksToClean = list.filter(e => {
			let include = e.transport.callback.indexOf(this.url) > -1;
			if(uid && profile) {
				include =  include
						&& e.condition.broadcaster_user_id == uid
						&& e.transport.callback.split("profile=")[1] == profile;
			}
			return include;
		});
		Logger.info("📢 EventSub Cleaning up "+callbacksToClean.length+" subscriptions...");
		for (let i = 0; i < callbacksToClean.length; i++) {
			const subscription = list[i];
			let opts = {
				method:"DELETE",
				headers:{
					"Client-ID": Config.TWITCH_APP_CLIENT_ID,
					"Authorization": "Bearer "+this.token,
					"Content-Type": "application/json",
				}
			}
			await fetch("https://api.twitch.tv/helix/eventsub/subscriptions?id="+subscription.id, opts).catch(error=>{
				Logger.error("📢 EventSub Cleanup error for:", subscription.type)
			})
		}
		Logger.success("📢 EventSub Cleaning up complete for "+callbacksToClean.length+" subscriptions");
	}

	/**
	 * Displays OAuth URL to accept scopes access
	 */
	private logOAuthURL():void {
		Logger.error("📢 Authorization must be granted to the Twitch app !");
		Logger.error("📢 Open this URL on the browser");
		console.log(LogStyle.BgRed+"https://id.twitch.tv/oauth2/authorize?client_id="+Config.TWITCH_APP_CLIENT_ID+"&redirect_uri=http%3A%2F%2Flocalhost%3A3009%2Foauth&response_type=token&scope="+Config.TWITCH_APP_SCOPES+LogStyle.Reset);
	}

}

export interface EventSubMessage {
	subscription: EventSubMessageSubType.Subscription;
	event: EventSubMessageSubType.Event;
}

export declare module EventSubMessageSubType {

    export interface Condition {
        broadcaster_user_id: string;
    }

    export interface Transport {
        method: string;
        callback: string;
    }

    export interface Subscription {
        id: string;
        status: string;
        type: string;
        version: string;
        cost: number;
        condition: Condition;
        transport: Transport;
        created_at: Date;
    }

    export interface Event {
        user_id: string;
        user_login: string;
        user_name: string;
        broadcaster_user_id: string;
        broadcaster_user_login: string;
        broadcaster_user_name: string;
		user_input: string;
		status: string;
		redeemed_at: string;
		reward: {
			id: string;
			title: string;
			prompt: string;
			cost: number;
		};
	}
}