
/**
 * Created by Durss
 */
export default class Config {

	public static IS_PROD:boolean = /.*\.(com|fr|net|org|ninja|st)$/gi.test(window.location.hostname);
	public static STORAGE_VERSION:number = 1;
	public static OBS_WS_PASSWORD:string =				/* value hidden out of screen ▪▪▪▪► */																				"8sUUYn#IS2";
	public static SPOTIFY_CLIENT:string =				/* value hidden out of screen ▪▪▪▪► */																				"91e42840545646369677d6748d7dcbce";
	public static SPOTIFY_SECRET:string =				/* value hidden out of screen ▪▪▪▪► */																				"0fef69fac8c24d91b8fe2f3150595065";
	
	private static _ENV_NAME: EnvName;

	public static init():void {
		let prod = this.IS_PROD;//document.location.port == "";
		if(prod) this._ENV_NAME = "prod";
		else this._ENV_NAME = "dev";
	}
	
	public static get SERVER_PORT(): number {
		return this.getEnvData({
			dev: 3009,
			prod: document.location.port,
		});
	}
	
	public static get SOCKET_PATH():string{
		if(this.IS_PROD) {
			return "/sock";
		}else{
			return window.location.origin.replace(/(.*):[0-9]+/gi, "$1")+":"+this.SERVER_PORT+"/sock";
		}
	};
	
	public static get API_PATH(): string {
		return this.getEnvData({
			dev: document.location.protocol+"//"+document.location.hostname+":"+this.SERVER_PORT+"/api",
			prod:"/api",
		});
	}
	
	public static get PUBLIC_PATH(): string {
		return this.getEnvData({
			dev: document.location.protocol+"//"+document.location.hostname+":"+this.SERVER_PORT+"/",
			prod:"/",
		});
	}
	

	

	/**
	 * Extract a data from an hasmap depending on the current environment.
	 * @param map
	 * @returns {any}
	 */
	private static getEnvData(map: any): any {
		//Get the data from hashmap
		if (map[this._ENV_NAME] !== undefined) return map[this._ENV_NAME];
		return map[Object.keys(map)[0]];
	}
}

type EnvName = "dev" | "preprod" | "prod" | "standalone";