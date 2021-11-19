import * as dialogflow from "@google-cloud/dialogflow";
import * as uuid from "uuid"
import * as path from "path";
import Logger from "./Logger";
/**
* Created : 20/03/2021 
*/
export default class DialogflowHelper {

	private static _instance:DialogflowHelper;
	private sessionPath:string;
	private client:dialogflow.SessionsClient;
	
	constructor() {
	
	}
	
	/********************
	* GETTER / SETTERS *
	********************/
	static get instance():DialogflowHelper {
		if(!DialogflowHelper._instance) {
			DialogflowHelper._instance = new DialogflowHelper();
			DialogflowHelper._instance.initialize();
		}
		return DialogflowHelper._instance;
	}
	
	
	
	/******************
	* PUBLIC METHODS *
	******************/
	public async parse(str:string):Promise<dialogflow.protos.google.cloud.dialogflow.v2.IQueryResult> {
		const request = {
			session: this.sessionPath,
			queryInput: {
				text: {
				text: str,
				languageCode: 'fr-FR',
				},
			},
		};
		
		const responses = await this.client.detectIntent(request);
		let action = responses[0].queryResult.action;
		Logger.info("Intent detected:",action);
		return responses[0].queryResult;
	}
	
	
	
	/*******************
	* PRIVATE METHODS *
	*******************/
	private initialize():void {
		this.client = new dialogflow.SessionsClient({
			projectId:"turnkey-cocoa-308120",
			keyFile:path.join(__dirname, "../../text2speechID.json"),
		});
		this.sessionPath = this.client.projectAgentSessionPath("turnkey-cocoa-308120", uuid.v4());
	}
}