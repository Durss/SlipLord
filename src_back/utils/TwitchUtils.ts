import fetch from "node-fetch";
import Config from "./Config";

/**
* Created : 08/07/2021 
*/
export default class TwitchUtils {

	private static _token:string|null;
	private static _token_invalidation_date:number;
	
	constructor() {
	
	}
	
	/********************
	* GETTER / SETTERS *
	********************/

	public static get ready():boolean {
		return this._token != null && this._token != undefined;
	}
	
	
	
	/******************
	* PUBLIC METHODS *
	******************/

	/**
	 * Generates a credential token if necessary from the client and private keys
	 * @returns 
	 */
	public static async getClientCredentialToken(force:boolean = false):Promise<string|null> {
		//Invalidate token if expiration date is passed
		if(Date.now() > this._token_invalidation_date || force) this._token = null;
		//Avoid generating a new token if one already exists
		if(this._token) return this._token;

		//Generate a new token
		let headers:any = {
		};
		var options = {
			method: "POST",
			headers: headers,
		};
		let result = await fetch("https://id.twitch.tv/oauth2/token?client_id="+Config.TWITCH_APP_CLIENT_ID+"&client_secret="+Config.TWITCH_APP_CLIENT_SECRET+"&grant_type=client_credentials&scope=", options)
		if(result.status == 200) {
			let json =await result.json()
			this._token = json.access_token;
			this._token_invalidation_date = Date.now() + (json.expires_in - 60000);
			return json.access_token;
		}else{
			throw("Token generation failed");
		}
	}

	/**
	 * Gets info about a channel from their login or ID
	 * @param logins 
	 * @param ids 
	 * @returns 
	 */
	public static async loadChannelsInfo(logins:string[]|null, ids:string[]|null = null):Promise<TwitchTypes.UserInfo[]> {
		await this.getClientCredentialToken();//This will refresh the token if necessary
	
		let items:string[] | null = ids? ids : logins;
		if(items == undefined) return [];
		items = items.filter(v => v != null && v != undefined);
		items = items.map(v => encodeURIComponent(v));
	
		let users:TwitchTypes.UserInfo[] = [];
		//Split by 100 max to comply with API limitations
		while(items.length > 0) {
			const param = ids ? "id" : "login";
			const params = param+"="+items.splice(0,100).join("&"+param+"=");
			const url = Config.TWITCH_API_PATH+"users?"+params;
			const result = await fetch(url, {
				headers:{
					"Client-ID": Config.TWITCH_APP_CLIENT_ID,
					"Authorization": "Bearer "+this._token,
					"Content-Type": "application/json",
				}
			});
			const json = await result.json();
			users = users.concat(json.data);
		}
		return users;
	}

	/**
	 * Get info about a user's stream from their login or ID
	 * @param logins 
	 * @param ids 
	 * @param failSafe 
	 * @returns 
	 */
	public static async getStreamsInfos(logins:string[]|null, ids?:string[], failSafe:boolean = true):Promise<TwitchTypes.StreamInfo[]> {
		await this.getClientCredentialToken();//This will refresh the token if necessary

		let params = "";
		if(logins) {
			logins = logins.filter(v => v != null && v != undefined);
			params = "user_login="+logins.join("&user_login=")
		}else if(ids){
			ids = ids.filter(v => v != null && v != undefined);
			params = "user_id="+ids.join("&user_id=");
		}

		let url = "https://api.twitch.tv/helix/streams?"+params;
		
		let result = await fetch(url, {
			headers:{
				"Client-ID": Config.TWITCH_APP_CLIENT_ID,
				"Authorization": "Bearer "+this._token,
				"Content-Type": "application/json",
			}
		});
		
		if(result.status != 200) {
			//Token seem to expire before it's actual EOL date.
			//Make sure here the next request will work.
			if(result.status == 401) {
				this.getClientCredentialToken(true);
				if(failSafe) {
					return await this.getStreamsInfos(logins, ids, false);
				}
			}
			let txt = await result.text();
			throw(txt);
		}else{
			let json = await result.json();
			return json.data
		}
	}

	/**
	 * Get eventsub current subscription list
	 * @returns 
	 */
	public static async getEventsubSubscriptions():Promise<TwitchTypes.EventsubSubscription[]> {
		await this.getClientCredentialToken();//This will refresh the token if necessary
		let list:TwitchTypes.EventsubSubscription[] = [];
		let cursor:string|null = null;
		const headers = {
			"Client-ID": Config.TWITCH_APP_CLIENT_ID,
			"Authorization": "Bearer "+this._token,
			"Content-Type": "application/json",
		};
		do {
			const url = new URL("https://api.twitch.tv/helix/eventsub/subscriptions");
			url.searchParams.append("type", "stream.online");
			if(cursor) url.searchParams.append("after", cursor);
			const res = await fetch(url.href, {headers});
			if(res.status != 200) return [];//As i managed to corrupt my twitch data, i need this to avoid errors everytime
			const json:{data:TwitchTypes.EventsubSubscription[], pagination?:{cursor?:string}} = await res.json();
			list = list.concat(json.data);
			cursor = null;
			if(json.pagination?.cursor) {
				cursor = json.pagination.cursor;
			}
		}while(cursor != null)
		return list;
	}

	/**
	 * Create a new eventsub subscription
	 * @param uid 
	 * @param callbackURI 
	 * @returns 
	 */
	public static async eventsubSubscriptionCreate(uid:string, callbackURI:string, version:string = "1"):Promise<boolean> {
		await this.getClientCredentialToken();//This will refresh the token if necessary

		let opts = {
			method:"POST",
			headers:{
				"Client-ID": Config.TWITCH_APP_CLIENT_ID,
				"Authorization": "Bearer "+this._token,
				"Content-Type": "application/json",
			},
			body:JSON.stringify({
				"type": "stream.online",
				"version": version,
				"condition": {
					"broadcaster_user_id": uid
				},
				"transport": {
					"method": "webhook",
					"callback": callbackURI,
					"secret": Config.TWITCH_EVENTSUB_SECRET,
				}
			})
		};
		
		try {
			let res = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", opts);
			if(res.status == 403) {
				return false;
			}
			// console.log(await res.json());
		}catch(error) {
			console.log(error);
			throw(error);
		}
		return true
	}

	/**
	 * Get info about a user's stream from their login or ID
	 * @param id subscription ID 
	 * @returns 
	 */
	public static async eventsubSubscriptionDelete(id:string):Promise<boolean> {
		await this.getClientCredentialToken();//This will refresh the token if necessary
		const headers = {
			"Client-ID": Config.TWITCH_APP_CLIENT_ID,
			"Authorization": "Bearer "+this._token,
			"Content-Type": "application/json",
		};
		const url = new URL("https://api.twitch.tv/helix/eventsub/subscriptions");
		url.searchParams.append("id", id);
		const res = await fetch(url.href, {method:"DELETE", headers});
		if(res.status == 204) return true;
		return false;
	}
	
	/**
	 * Makes sure a token is still valid
	 */
	public static validateToken(token:string):Promise<boolean|any> {
		return new Promise((resolve, reject) => {
			let headers:any = {
				"Authorization":"OAuth "+token
			};
			var options = {
				method: "GET",
				headers: headers,
			};
			fetch("https://id.twitch.tv/oauth2/validate", options)
			.then(async(result) => {
				if(result.status == 200) {
					result.json().then((json)=> {
						resolve(json)
					});
				}else{
					resolve(false);
				}
			});
		});
	}
	
	
	
	/*******************
	* PRIVATE METHODS *
	*******************/
}

export namespace TwitchTypes {
	export interface ModeratorUser {
		user_id: string;
		user_login: string;
		user_name: string;
	}
	
	export interface Token {
		client_id: string;
		login: string;
		scopes: string[];
		user_id: string;
		expires_in: number;
	}
	
	export interface Error {
		status: number;
		message: string;
	}

	export interface StreamInfo {
		id:            string;
		user_id:       string;
		user_login:    string;
		user_name:     string;
		game_id:       string;
		game_name:     string;
		type:          string;
		title:         string;
		viewer_count:  number;
		started_at:    string;
		language:      string;
		thumbnail_url: string;
		tag_ids:       string[];
		//Custom tag
		user_info:     UserInfo;
	}

	export interface ChannelInfo {
		broadcaster_id:        string;
		broadcaster_login:     string;
		broadcaster_name:      string;
		broadcaster_language:  string;
		game_id:               string;
		game_name:             string;
		title:                 string;
		delay:                 number;
	}

	export interface UserInfo {
		id:                string;
		login:             string;
		display_name:      string;
		type:              string;
		broadcaster_type:  string;
		description:       string;
		profile_image_url: string;
		offline_image_url: string;
		view_count:        number;
		created_at:        string;
	}

	export interface BadgesSet {
		versions: {[key:string]:Badge};
	}

	export interface Badge {
		id: string;
		click_action: string;
		click_url: string;
		description: string;
		image_url_1x: string;
		image_url_2x: string;
		image_url_4x: string;
	}

	export interface AuthTokenResult {
		access_token: string;
		expires_in: number;
		refresh_token: string;
		scope: string[];
		token_type: string;
		//Custom injected data
		expires_at: number;
	}

	export interface CheermoteSet {
		prefix: string;
		tiers: CheermoteTier[];
		type: string;
		order: number;
		last_updated: Date;
		is_charitable: boolean;
	}
	export interface CheermoteTier {
		min_bits: number;
		id: string;
		color: string;
		images: {
			dark: CheermoteImageSet;
			light: CheermoteImageSet;
		};
		can_cheer: boolean;
		show_in_bits_card: boolean;
	}

	export interface CheermoteImageSet {
		animated: CheermoteImage;
		static: CheermoteImage;
	}

	export interface CheermoteImage {
		"1": string;
		"2": string;
		"3": string;
		"4": string;
		"1.5": string;
	}

	export interface Poll {
		id: string;
		broadcaster_id: string;
		broadcaster_name: string;
		broadcaster_login: string;
		title: string;
		choices: PollChoice[];
		bits_voting_enabled: boolean;
		bits_per_vote: number;
		channel_points_voting_enabled: boolean;
		channel_points_per_vote: number;
		status: "ACTIVE" | "COMPLETED" | "TERMINATED" | "ARCHIVED" | "MODERATED" | "INVALID";
		duration: number;
		started_at: string;
		ended_at?: string;
	}

	export interface PollChoice {
		id: string;
		title: string;
		votes: number;
		channel_points_votes: number;
		bits_votes: number;
	}

	export interface HypeTrain {
		id: string;
		event_type: string;
		event_timestamp: Date;
		version: string;
		event_data: {
			broadcaster_id: string;
			cooldown_end_time: string;
			expires_at: string;
			goal: number;
			id: string;
			last_contribution: {
				total: number;
				type: string;
				user: string;
			};
			level: number;
			started_at: string;
			top_contributions: {
				total: number;
				type: string;
				user: string;
			};
			total: number;
		};
	}

	export interface Prediction {
		id: string;
		broadcaster_id: string;
		broadcaster_name: string;
		broadcaster_login: string;
		title: string;
		winning_outcome_id?: string;
		outcomes: PredictionOutcome[];
		prediction_window: number;
		status: "ACTIVE" | "RESOLVED" | "CANCELED" | "LOCKED";
		created_at: string;
		ended_at?: string;
		locked_at?: string;
	}

	export interface PredictionOutcome {
		id: string;
		title: string;
		users: number;
		channel_points: number;
		top_predictors?: PredictionPredictor[];
		color: string;
	}

	export interface PredictionPredictor {
		id:string;
		name:string;
		login:string;
		channel_points_used:number;
		channel_points_won:number;
	}

	export interface Emote {
		id: string;
		name: string;
		images: {
			url_1x: string;
			url_2x: string;
			url_4x: string;
		};
		emote_type: string;
		emote_set_id: string;
		owner_id: string;
		format: "static" | "animated";
		scale: "1.0" | "2.0" | "3.0";
		theme_mode: "light" | "dark";
	}


	export interface Reward {
		broadcaster_name: string;
		broadcaster_login: string;
		broadcaster_id: string;
		id: string;
		image?: {
			url_1x: string;
			url_2x: string;
			url_4x: string;
		};
		background_color: string;
		is_enabled: boolean;
		cost: number;
		title: string;
		prompt: string;
		is_user_input_required: boolean;
		max_per_stream_setting: {
			is_enabled: boolean;
			max_per_stream: number;
		};
		max_per_user_per_stream_setting: {
			is_enabled: boolean;
			max_per_user_per_stream: number;
		};
		global_cooldown_setting: {
			is_enabled: boolean;
			global_cooldown_seconds: number;
		};
		is_paused: boolean;
		is_in_stock: boolean;
		default_image: {
			url_1x: string;
			url_2x: string;
			url_4x: string;
		};
		should_redemptions_skip_request_queue: boolean;
		redemptions_redeemed_current_stream?: number;
		cooldown_expires_at?: string;
	}

	export interface RewardRedemption {
		broadcaster_name: string;
		broadcaster_login: string;
		broadcaster_id: string;
		id: string;
		user_login: string;
		user_id: string;
		user_name: string;
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
	
	export interface Following {
		from_id: string;
		from_login: string;
		from_name: string;
		to_id: string;
		to_name: string;
		followed_at: string;
	}

	export interface EventsubSubscription {
        id: string;
        status: "webhook_callback_verification_failed" | "enabled" | "notification_failures_exceeded" | "webhook_callback_verification_pending" | "authorization_revoked" | "user_removed" | "version_removed";
        type: string;
        version: string;
        condition: {
			broadcaster_user_id: string;
		};
        created_at: string;
        transport: {
			method: string;
			callback: string;
		};
        cost: number;
    }
}