import * as sockjs from "sockjs";
import { Connection, ServerOptions } from "sockjs";
import Config from "../utils/Config";
import { EventDispatcher } from "../utils/EventDispatcher";
import Logger from "../utils/Logger";
import SocketEvent from "../vo/SocketEvent";

/**
 * Created by Durss on 28/03/2019
 */

export default class SocketServer extends EventDispatcher {


	private static _instance: SocketServer;
	private _DISABLED: boolean = false;
	private _sockjs: any;
	private _connections:Connection[];

	constructor() {
		super()
		this.initialize();
	}

	/********************
	 * GETTER / SETTERS *
	 ********************/
	static get instance(): SocketServer {
		if (!SocketServer._instance) SocketServer._instance = new SocketServer();
		return SocketServer._instance;
	}


	/******************
	 * PUBLIC METHODS *
	 ******************/

	public connect() {
		if(this._DISABLED) return;
		this._sockjs = sockjs.createServer({log: (severity, message)=> {
			if(severity == "debug") {
				Logger.success(message+" on port "+Config.SERVER_PORT);
				return;
			}
		}});
		this._sockjs.on("connection", (conn:Connection)=> this.onConnect(conn));
	}

	/**
	 * Broadcast a message to all pears
	 * @param msg
	 */
	public broadcast(msg:{action:SOCK_ACTIONS, data?:any}) {
		if(this._DISABLED) return;
		// Logger.info("BROADCAST to "+this._connections.length+" users : ", msg.action);
		for (let i = 0; i < this._connections.length; ++i) {
			this._connections[i].write(JSON.stringify(msg));
		}
		this.dispatchEvent(new SocketEvent(msg.action, msg.data));
	}

	/**
	 * Connects express to socket
	 * @param server
	 * @param scope
	 */
	public installHandler(server, scope : ServerOptions) {
		if(this._DISABLED) return;
		this.connect();
		this._sockjs.installHandlers(server, scope);
	}



	/*******************
	 * PRIVATE METHODS *
	 *******************/
	/**
	 * Initializes the class
	 */
	private initialize(): void {
		if(this._DISABLED) return;
		this._connections = [];
	}

	private onConnect(conn:Connection):void {
		if(this._DISABLED) return;
		this._connections.push(conn);

		// Logger.info("Socket connexion opened : "+LogStyle.Reset+conn.id);
		conn.on("data", (message) => {
			let json:{action:SOCK_ACTIONS, data:any} = JSON.parse(message);
			if(json.action == SOCK_ACTIONS.PING) {
				//Don't care, just sent to check if connection's style alive
				return;
			}else{
				if(this._DISABLED) return;
				this.broadcast(json);
			}
		});
		conn.on("close", (p) => {
			this.onClose(conn);
		});
	}

	private onClose(conn:Connection):void {
		if(this._DISABLED) return;
		conn.close();
		// Logger.info("Socket connexion closed : "+LogStyle.Reset+conn.id);
		//Cleanup user's connection from memory
		let idx = this._connections.indexOf(conn);
		if(idx) {
			this._connections.splice(idx, 1);
		}
	}

}

export enum SOCK_ACTIONS {
	PING="PING",
	ONLINE="ONLINE",
	OFFLINE="OFFLINE",
	BOX_3D_STATE="BOX_3D_STATE",
	BOX_3D_ROTATE="BOX_3D_ROTATE",
	BOX_3D_ZOOM="BOX_3D_ZOOM",
	UPDATE_MESSAGE="UPDATE_MESSAGE",
	WORMS_PARAMS="WORMS_PARAMS",
	VOICE_CMD="VOICE_CMD",
	ALERTS_CONFIG="ALERTS_CONFIG",
	CHANNEL_FOLLOW="channel.follow",
	CHANNEL_SUBSCRIBE="channel.subscribe",
	CHANNEL_CHEER="channel.cheer",
	CHANNEL_RAID="channel.raid",
	CHANNEL_HOST="channel.host",
	CHANNEL_SUBGIFT="channel.gift",
	CHANNEL_REDEEM="channel.channel_points_custom_reward_redemption.add",
	CHANNEL_MESSAGE="CHANNEL_MESSAGE",
	TOGGLE_MICROPHONE="TOGGLE_MICROPHONE",
	ENABLE_COMMAND_ABUSE="ENABLE_COMMAND_ABUSE",
	GENERIC_COMMAND="GENERIC_COMMAND",
	USER_SCORE="USER_SCORE",
	START_GAME="START_GAME",
	USER_LIST_UPDATE="USER_LIST_UPDATE",
	BONUS_LIST_UPDATE="BONUS_LIST_UPDATE",
	RELOAD_OVERLAY="RELOAD_OVERLAY",
	
	PREDICTION_START="channel.prediction.begin",
	PREDICTION_UPDATE="channel.prediction.progress",
	PREDICTION_LOCK="channel.prediction.lock",
	PREDICTION_END="channel.prediction.end",
	
	POLL_START="channel.poll.begin",
	POLL_PROGRESS="channel.poll.progress",
	POLL_END="channel.poll.end",
	
	MAZE_POS="MAZE_POS",
	MAZE_SIZE="MAZE_SIZE",
	MAZE_RESTART="MAZE_RESTART",
	MAZE_SHOW_HIDE="MAZE_SHOW_HIDE",
	MAZE_SKIP_COUNTDOWN="MAZE_SKIP_COUNTDOWN",
	
	SHOW_OBS_MAIN_SCENE="SHOW_OBS_MAIN_SCENE",
	
	VOICE_EFFECT_DISABLED="VOICE_EFFECT_ADISABLED",
	VOICE_EFFECT_ENABLED="VOICE_EFFECT_ENABLED",

	HEAT_CLICK="HEAT_CLICK",

	SPOTIFY_VOLUME="SPOTIFY_VOLUME",

	START_BOT="START_BOT",
	
	REFUND_USER="REFUND_USER",
	BLOCK_USER="BLOCK_USER",
	
	OBS_REPLAY="OBS_REPLAY",
	
	STREAMDECK_EVENT="STREAMDECK_EVENT",

	QUIZ_START="QUIZ_START",
	QUIZ_NEXT_STEP="QUIZ_NEXT_STEP",

	SHOUTOUT="SHOUTOUT",
};