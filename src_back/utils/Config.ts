import * as fs from "fs";
import * as path from "path";
import { LogStyle } from "../utils/Logger";
/**
 * Created by Durss
 */
export default class Config {

	private static _ENV_NAME: EnvName;
	private static _CONF_PATH: string = "env.conf";
	private static _CONFIGS_CACHE:{[key:string]:string} = null;
	
	public static get BOT_NAME():string { return this.getData("BOT_NAME"); 	}

	public static get TWITCH_LOGIN():string { return this.getData("TWITCH_LOGIN"); 	}
	public static get TWITCH_USER_ID():string { return this.getData("TWITCH_USER_ID"); }
	
	public static get TWITCH_EVENTSUB_SECRET():string { return this.getData("TWITCH_EVENTSUB_SECRET"); 	}
	public static get TWITCH_APP_CLIENT_ID():string { return this.getData("TWITCH_APP_CLIENT_ID"); 	}
	public static get PUBLIC_SECURED_URL():string { return this.getData("PUBLIC_SECURED_URL"); 	}
	public static get TWITCH_APP_CLIENT_SECRET():string { return this.getData("TWITCH_APP_CLIENT_SECRET"); 	}
	public static get TWITCH_APP_SCOPES():string { return this.getData("TWITCH_APP_SCOPES"); }
	
	public static get NGROK_AUTH_TOKEN():string { return this.getData("NGROK_AUTH_TOKEN"); }
	
	public static get DISCORDBOT_TOKEN(): string { return this.getData("DISCORDBOT_TOKEN"); }
	public static get DISCORDBOT_ROLES_EMOJIS(): string { return this.getData("DISCORDBOT_ROLES_EMOJIS"); }
	

	public static get envName(): string {
		return this._ENV_NAME;
	}

	public static get LOGS_ENABLED(): boolean {
		return this.getEnvData({
			dev: true,
			prod: false,
		});
	}

	public static get SERVER_PORT(): number {
		return this.getEnvData({
			dev: 3015,
			prod: 3015,
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

	private static getData(key:string):string {
		if(!this._CONFIGS_CACHE) {
			let json = fs.readFileSync(this.CONFIGS_PATH, "utf8");
			this._CONFIGS_CACHE = JSON.parse(json);
		}
		return this._CONFIGS_CACHE[key];
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
		if (map[this._ENV_NAME]) return map[this._ENV_NAME];
		return map[Object.keys(map)[0]];
	}
}

type EnvName = "dev" | "preprod" | "prod";