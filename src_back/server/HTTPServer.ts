import * as express from "express";
import { Express, NextFunction, Request, Response } from "express-serve-static-core";
import * as fs from "fs";
import * as http from "http";
import DiscordController from '../controllers/DiscordController';
import EventSubController from '../controllers/EventSubController';
import { StorageController } from '../controllers/StorageController';
import Config from '../utils/Config';
import { Event } from '../utils/EventDispatcher';
import Label from '../utils/Label';
import Logger from '../utils/Logger';
import SocketServer from "./SocketServer";

export default class HTTPServer {

	private app:Express;

	constructor(public port:number) {
		
		if(!fs.existsSync(Config.UPLOAD_PATH)) {
			fs.mkdirSync(Config.UPLOAD_PATH);
		}

		Label.initialize();

		this.app = <Express>express();
		let server = http.createServer(<any>this.app);
		SocketServer.instance.installHandler(server, {prefix:"/sock"});
		server.listen(Config.SERVER_PORT, '0.0.0.0', undefined, ()=> {
			Logger.success("Server ready on port " + Config.SERVER_PORT);
		});

		this.doPrepareApp();
	}

	protected initError(error: any): void {
		Logger.error("Error happened !", error);
	}

	protected doPrepareApp(): void {
		this.app.use((req:Request, res:Response, next:NextFunction) => {
			// Set CORS headers
			res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,PATCH,DELETE,OPTIONS');
			res.header('Access-Control-Allow-Headers', 'Content-type,Accept,X-Access-Token,X-Key,X-AUTH-TOKEN');
			res.header("Access-Control-Allow-Origin", "*");
			if (req.method == 'OPTIONS') {
				res.status(200).end();
				return;
			}
			
			next();
		});

		//SERVE UPLOADED FILES (e.g. twitch offline cards)
		this.app.use("/uploads", express.static(Config.UPLOAD_PATH));

		this.app.use(express.json());

		this.createEndpoints();
		
		this.app.use((error : any, request : Request, result : Response, next : NextFunction) => {
			this.errorHandler(error , request, result, next)
		});
		
		let fallback = async (req:Request, res:Response) => {
			console.log("NOT FOUND : ",req.url, req.method);
			res.status(404).send(JSON.stringify({success:false, code:"ENDPOINT_NOT_FOUND", message:"Requested endpoint does not exists"}));
		};
		this.app.use(fallback);
	}

	protected errorHandler(error: any, req: Request, res: Response, next: NextFunction): any {
		Logger.error("Express error");
		Logger.simpleLog(error);
		res.status(404).send(JSON.stringify({success:false, code:"EXPRESS_ERROR", message:"An error has occured while processing the request"}));
		next();
	}

	private async createEndpoints():Promise<void> {

		new StorageController().mount(this.app);
		
		this.app.get("/api", async (req, res) => {
			res.status(200).send(JSON.stringify({success:true}));
		});
		
		let discord = new DiscordController();
		if(Config.IS_TWITCH_CONFIGURED) {
			let eventSub:EventSubController = new EventSubController();
			await eventSub.mount(this.app);
			discord.addEventListener(Event.SUB_TO_LIVE_EVENT, (event:Event) => {
				eventSub.subToUser(event.channelId as string);
			});
			discord.addEventListener(Event.UNSUB_FROM_LIVE_EVENT, (event:Event) => {
				eventSub.unsubUser(event.channelId as string);
			});
			eventSub.addEventListener(Event.DISCORD_ALERT_LIVE, (event:Event) => {
				discord.alertLiveChannel(event.channelId as string);
			});
		}

		discord.mount(this.app);
		
		// let res = await TwitchUtils.loadChannelsInfo(["durssbot"]);
		// console.log(await res.json());
	}
}