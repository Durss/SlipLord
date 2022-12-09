import * as fs from "fs";
import * as path from "path";
import { LogStyle } from "../utils/Logger";
/**
 * Created by Durss
 */
export default class Config {

	private static _ENV_NAME: EnvName;
	private static _CONF_PATH: string = "env.conf";
	private static _CONFIGS_CACHE:{[key:string]:string}|null = null;
	
	public static TWITCH_API_PATH:string = "https://api.twitch.tv/helix/";
	
	public static get SERVER_PORT():number { return this.getData("SERVER_PORT") as number; 	}
	public static get BOT_NAME():string { return this.getData("BOT_NAME") as string; 	}
	public static get TIMEZONE_OFFSET():number { return this.getData("TIMEZONE_OFFSET") as number; 	}
	public static get CMD_PREFIX():string { return this.getData("CMD_PREFIX") as string; 	}

	public static get PUBLIC_SECURED_URL():string { return this.getData("PUBLIC_SECURED_URL") as string; 	}
	
	public static get TWITCH_EVENTSUB_SECRET():string { return this.getData("TWITCH_EVENTSUB_SECRET") as string; 	}
	public static get TWITCH_APP_CLIENT_ID():string { return this.getData("TWITCH_APP_CLIENT_ID") as string; 	}
	public static get TWITCH_APP_CLIENT_SECRET():string { return this.getData("TWITCH_APP_CLIENT_SECRET") as string; 	}
	public static get TWITCH_APP_SCOPES():string { return this.getData("TWITCH_APP_SCOPES") as string; }
	
	public static get DISCORDBOT_TOKEN(): string { return this.getData("DISCORDBOT_TOKEN") as string; }
	public static get DISCORDBOT_CLIENT_ID(): string { return this.getData("DISCORDBOT_CLIENT_ID") as string; }
	public static get DISCORDBOT_REACTION_EMOJIS(): string { return this.getData("DISCORDBOT_REACTION_EMOJIS") as string; }
	
	public static get envName(): string { return this._ENV_NAME;}

	public static get IS_TWITCH_CONFIGURED(): boolean {
		return this.TWITCH_APP_CLIENT_ID?.length > 0
		&& this.TWITCH_APP_CLIENT_SECRET?.length > 0
		&& this.TWITCH_EVENTSUB_SECRET?.length > 0
		&& this.PUBLIC_SECURED_URL?.length > 0;
	}

	public static get LOGS_ENABLED(): boolean {
		return this.getEnvData({
			dev: true,
			prod: true,
		});
	}

	public static get PUBLIC_PATH(): string {
		return this.getEnvData({
			dev: "./dist",
			prod: "./public",
		});
	}

	public static get UPLOAD_PATH(): string {
		return this.getEnvData({
			dev: "./uploads/",
			prod: path.resolve(__dirname+"/../uploads")+"/",
		});
	}

	public static get CONFIGS_PATH(): string {
		return this.getEnvData({
			dev: "./configs.json",
			prod: path.resolve(__dirname+"/../configs.json"),
		});
	}

	public static get LABELS_PATH(): string {
		return this.getEnvData({
			dev: "./labels.json",
			prod: path.resolve(__dirname+"/../labels.json"),
		});
	}

	private static getData(key:string):string|number {
		if(!this._CONFIGS_CACHE) {
			let json = fs.readFileSync(this.CONFIGS_PATH, "utf8");
			this._CONFIGS_CACHE = JSON.parse(json);
		}
		return (this._CONFIGS_CACHE as {[key: string]: string})[key];
	}


	/**
	 * Extract a data from an hasmap depending on the current environment.
	 * @param map
	 * @returns {any}
	 */
	private static getEnvData(map: any): any {
		//Grab env name the first time
		if (!this._ENV_NAME) {
			if (fs.existsSync(this._CONF_PATH)) {
				let content: string = fs.readFileSync(this._CONF_PATH, "utf8");
				this._ENV_NAME = <EnvName>content;
				let str: String = "  :: Current environment \"" + content + "\" ::  ";
				let head: string = str.replace(/./g, " ");
				console.log("\n");
				console.log(LogStyle.BgGreen + head + LogStyle.Reset);
				console.log(LogStyle.Bright + LogStyle.BgGreen + LogStyle.FgWhite + str + LogStyle.Reset);
				console.log(LogStyle.BgGreen + head + LogStyle.Reset);
				console.log("\n");
				
			} else {
				this._ENV_NAME = "dev";
				fs.writeFileSync(this._CONF_PATH, this._ENV_NAME);
				let str: String = "  /!\\ Missing file \"./" + this._CONF_PATH + "\" /!\\  ";
				let head: string = str.replace(/./g, " ");
				console.log("\n");
				console.log(LogStyle.BgRed + head + LogStyle.Reset);
				console.log(LogStyle.Bright + LogStyle.BgRed + LogStyle.FgWhite + str + LogStyle.Reset);
				console.log(LogStyle.BgRed + head + LogStyle.Reset);
				console.log("\n");
				console.log("Creating env.conf file autmatically and set it to \"standalone\"\n\n");
			}
		}

		//Get the data from hashmap
		if (map[this._ENV_NAME] != undefined) return map[this._ENV_NAME];
		return map[Object.keys(map)[0]];
	}
}

type EnvName = "dev" | "preprod" | "prod";