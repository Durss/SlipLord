import { HmacSHA256 } from "crypto-js";
import { Express, Request, Response } from "express-serve-static-core";
import Config from "../utils/Config";
import Logger, { LogStyle } from '../utils/Logger';
import TwitchUtils from "../utils/TwitchUtils";
import { Event, EventDispatcher } from "../utils/EventDispatcher";
import { StorageController, TwitchUser } from "./StorageController";

/**
* Created : 25/10/2021 
*/
export default class EventSubController extends EventDispatcher {

	private app:Express;
	private url!:string;
	private idsParsed:{[key:string]:boolean} = {};
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
			callbackUrl = Config.PUBLIC_SECURED_URL+"api/eventsubcallback";
		}
		if(callbackUrl) {
			this.url = callbackUrl.replace(/\/+$/gi, "")+"/";

			this.sanitizeSubscriptions();
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

		try {
			if(!await TwitchUtils.eventsubSubscriptionCreate(uid, this.url)) {
				this.logOAuthURL();
				return;
			}
		}catch(error) {
			setTimeout(() => this.subToUser(uid), 10000);
		}

		this.subToList.push(uid);
		//Debounce that log in case we're subscribing to multiple users at once
		clearTimeout(this.challengeCompleteLogTimeout);
		this.challengeCompleteLogTimeout = setTimeout(_=> {
			Logger.info("📢 EventSub subscribing to "+this.subToList.length+" users and wait for eventsub challenge :",this.subToList);
			this.subToList = [];
		}, 1000);
	}

	/**
	 * Stops receiving live notifications for a specific user
	 * 
	 * @param uid	specify a user ID to remove a specific event sub
	 * @returns 
	 */
	public async unsubUser(uid?:string):Promise<void> {
		let list = await TwitchUtils.getEventsubSubscriptions();

		// console.log(json.total_cost);
		// console.log(json.max_total_cost);
		// console.log(json.pagination);
		// console.log(json.data.length+" / "+json.total);
		// console.log("LOADED COUNT ", list.length);
		

		//Filtering out only callbacks for current environment
		let callbacksToClean = list.filter(e => {
			let include = e.transport.callback.indexOf(this.url) > -1;
			if(uid) {
				include =  include && e.condition.broadcaster_user_id == uid;
			}
			return include;
		});
		Logger.info("📢 EventSub Cleaning up "+callbacksToClean.length+" subscriptions...");
		for (let i = 0; i < callbacksToClean.length; i++) {
			const subscription = list[i];
			if(!await TwitchUtils.eventsubSubscriptionDelete(subscription.id)) {
				Logger.error("📢 EventSub Cleanup error for:", subscription.type)
			}
		}

		Logger.success("📢 EventSub Cleaning up complete for "+callbacksToClean.length+" subscriptions");
	}


	
	
	/*******************
	* PRIVATE METHODS *
	*******************/
	private async sanitizeSubscriptions():Promise<void> {
		const subscriptions = await TwitchUtils.getEventsubSubscriptions();
		const existing:{[key:string]:boolean} = {};
		const usersSubed:{[key:string]:boolean} = {};
		const users:TwitchUser[] = StorageController.getAllValues(StorageController.TWITCH_USERS);

		Logger.info("📢 EventSub sanitizing eventsub subscriptions... ("+(users?.length ?? 0)+" users expected, "+(subscriptions?.length ?? 0)+" subscriptions found)");

		for (let i = 0; i < subscriptions.length; i++) {
			const s = subscriptions[i];
			if(s.status != "enabled") {
				Logger.warn("📢 EventSub Deleting inactive subscription (status:"+s.status+") for user:", s.condition.broadcaster_user_id);
				await TwitchUtils.eventsubSubscriptionDelete(s.id);
			}else{
				const key = s.condition.broadcaster_user_id+"_"+s.transport.method+"_"+s.type;
				if(existing[key] === true) {
					Logger.warn("📢 EventSub Deleting duplicate subscription (type:"+s.type+") for user:", s.condition.broadcaster_user_id);
					await TwitchUtils.eventsubSubscriptionDelete(s.id);
				}else{
					Logger.info("📢 EventSub Keep existing subscription (type:"+s.type+") for user:", s.condition.broadcaster_user_id);
				}
				if(users.findIndex(v=>v.uid == s.condition.broadcaster_user_id) == -1) {
					Logger.warn("📢 EventSub Deleting invalid remaining subscription (type:"+s.type+") for user: ", s.condition.broadcaster_user_id);
					await TwitchUtils.eventsubSubscriptionDelete(s.id);
				}
				usersSubed[s.condition.broadcaster_user_id] = true;
				existing[key] = true;
			}
		}
		
		for (let i = 0; i < users.length; i++) {
			const u = users[i];
			//If user has no live subscription, create it
			if(usersSubed[u.uid] !== true) {
				Logger.warn("📢 EventSub Create missing subscription for user: ", u.uid);
				this.subToUser(u.uid);
			}
		}

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
				this.dispatchEvent(new Event(Event.DISCORD_ALERT_LIVE, uid));
			}
		}
		this.idsParsed[id] = true;
		res.sendStatus(200);
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