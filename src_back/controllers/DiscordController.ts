import * as Discord from "discord.js";
import { Express } from "express-serve-static-core";
import Config from "../utils/Config";
import { Event, EventDispatcher } from "../utils/EventDispatcher";
import Logger from '../utils/Logger';
import TwitchUtils, { TwitchStreamInfos, TwitchUserInfos } from "../utils/TwitchUtils";
import Utils from "../utils/Utils";
import { StorageController } from "./StorageController";

/**
* Created : 15/10/2020 
*/
export default class DiscordController extends EventDispatcher {

	private client:Discord.Client;
	private maxViewersCount:{[key:string]:number} = {};
	private lastStreamInfos:{[key:string]:TwitchStreamInfos} = {};
	private BOT_TOKEN:string = Config.DISCORDBOT_TOKEN;
	
	
	constructor() {
		super();
	}
	
	/********************
	* GETTER / SETTERS *
	********************/
	
	
	
	/******************
	* PUBLIC METHODS *
	******************/
	public async mount(app:Express):Promise<void> {
		if(!this.BOT_TOKEN) return;
		
		this.subToUser();
		
		this.client = new Discord.Client({ intents: [
			Discord.Intents.FLAGS.GUILDS,
			Discord.Intents.FLAGS.GUILD_MESSAGES,
			Discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
			Discord.Intents.FLAGS.DIRECT_MESSAGE_REACTIONS,
			Discord.Intents.FLAGS.DIRECT_MESSAGES
		] });

		this.client.on("messageCreate", (message) => this.onMessage(message));
		
		this.client.on("messageReactionAdd", (reaction) => this.onAddReaction(reaction as Discord.MessageReaction));
		this.client.on("messageReactionRemove", (reaction) => this.onRemoveReaction(reaction as Discord.MessageReaction));

		this.client.on("ready", ()=> this.onReady());

		this.client.on("guildMemberAdd", (member) => this.onAddMember(member))

		this.client.on("raw", (link) => {
			// console.log("ON RAW")
			// console.log(link);
		});
		
		try {
			await this.client.login(this.BOT_TOKEN);
		}catch(error) {
			Logger.error("Invalid discord token !");
			console.log(error);
		}
	}

	/**
	 * Sends a message to warn that a user went live on twitch
	 */
	public async alertLiveChannel(uid:string, attemptCount:number = 0, editedMessage?:Discord.Message):Promise<void> {
		//If there's data in cache, it's becasue the stream is already live.
		//Avoid having two messages for the same stream by ignoring this one.
		if(this.lastStreamInfos[uid] && !editedMessage) return;

		let res = await TwitchUtils.getStreamsInfos(null, [uid]);
		let streamDetails = res.data[0];
		if(!streamDetails) {
			let maxAttempt = 10;
			if(attemptCount < maxAttempt) {
				if(!editedMessage) {
					Logger.info("No stream infos found for user " + uid + " try again.");
				}
				setTimeout(_=> this.alertLiveChannel(uid, attemptCount+1, editedMessage), 5000 * (attemptCount+1));
			}

			if(attemptCount>=maxAttempt && editedMessage) {
				//user closed his/her stream, replace the stream picture by the offline one
				let res = await TwitchUtils.loadChannelsInfo(null, [uid]);
				let userInfo:TwitchUserInfos = (await res.json()).data[0];

				let card = this.buildLiveCard(this.lastStreamInfos[userInfo.id], userInfo, false, true);
				await editedMessage.edit({embeds:[card]});
				delete this.lastStreamInfos[userInfo.id];
				delete this.maxViewersCount[userInfo.id];
			}
			return;
		}
		
		//Get channels IDs in which send alerts
		let channelID = StorageController.getData(StorageController.LIVE_CHANNEL);
		if(channelID) {
			//Get actual channel's reference
			let channel = this.client.channels.cache.get(channelID) as Discord.TextChannel;
			if(channel) {
				//Get twitch channel's infos
				let res = await TwitchUtils.loadChannelsInfo(null, [uid]);
				let userInfo:TwitchUserInfos = (await res.json()).data[0];
				let card = this.buildLiveCard(streamDetails, userInfo, editedMessage!=null);
				let message:Discord.Message;
				if(editedMessage) {
					//Edit existing message
					message = editedMessage;
					message = await message.edit({embeds:[card]});
				}else{
					message = await channel.send({embeds:[card]});
				}
				//Schedule message update 1min later
				setTimeout(_=> {
					this.alertLiveChannel(uid, 0, message);
				}, 1 * 60 * 1000);
			}else{
				Logger.error("Channel not found");
			}
		}
	}
	
	
	
	/*******************
	* PRIVATE METHODS *
	*******************/
	private async onReady():Promise<void> {
		Logger.success("Discord bot connected");
		let channelID = StorageController.getData(StorageController.ROLES_CHANNEL);
		if(channelID) {
			//Forces refresh of the message so we can receive reactions even
			//after a reboot of the server
			this.sendRolesSelector();
		}
	}

	private subToUser() {
		this.dispatchEvent(new Event(Event.SUB_TO_LIVE_EVENT, Config.TWITCH_USER_ID));
	}

	/**
	 * Called when someone sends a message to a channel
	 * 
	 * @param message 
	 */
	private async onMessage(message:Discord.Message):Promise<void> {
		// console.log("Message received : ", message.author.bot, message.channel.type, message.content);
		
		if (message.author.bot) return;
		if (message.channel.type == "DM") return
		
		if(message.content.indexOf("!") == 0) this.parseCommand(message);
	}

	/**
	 * Called when someone uses a reaction on a message
	 */
	private async onAddReaction(reaction:Discord.MessageReaction):Promise<void> {
		let messageID = StorageController.getData(StorageController.ROLES_SELECTOR_MESSAGE);
		if(reaction.message.id != messageID) return;

		let authorId = reaction.message.author.id;
		let users = reaction.users.cache.entries();
		let userId:string;
		let roles:{[key:string]:string} = StorageController.getData(StorageController.ROLES_EMOJIS);
		let roleId = roles[reaction.emoji.name];

		//Get channels IDs in which send alerts
		let channelID = StorageController.getData(StorageController.ROLES_CHANNEL);
		if(!roleId) {
			//If using an unsupported emote juste remove the reaction
			await reaction.remove();
			return;
		}
		if(channelID) {
			//Get actual channel's reference
			let channel = this.client.channels.cache.get(channelID) as Discord.TextChannel;

			do {
				if(userId && userId != authorId) {
					let user = await reaction.message.guild.members.fetch(userId);
					let answer:Discord.Message;
					if(roleId == "DELETE_ALL") {
						user.roles.cache.forEach(role => {
							if(role.mentionable) {
								user.roles.remove(role.id);
							}
						});
						answer = await channel.send(`<@${userId}>, tous tes rôles ont bien été retirés.`);
					}else{
						let role = await reaction.message.guild.roles.fetch(roleId);
						answer = await channel.send(`<@${userId}>, le role **${role.name}** t'a bien été attribué !`);
						user.roles.add(roleId);
						
					}
					reaction.users.remove(userId);
					setTimeout(async _=> {
						try {
							await answer.delete();
						}catch(error) {};
					}, 10000);
				}
				let next = users.next();
				userId = next.value ? next.value[0] : null;
			}while(userId);
		}
	}

	/**
	 * Called when someone uses a reaction on a message
	 */
	private async onRemoveReaction(reaction:Discord.MessageReaction):Promise<void> {
		// console.log("ON REMOVE REACTION");
		// console.log(reaction.emoji.name);
		// console.log(reaction);
	}

	/**
	 * Called when someone joins the discord server
	 * @param member 
	 */
	private onAddMember(member:Discord.GuildMember | Discord.PartialGuildMember) {
		// console.log("New member ! ", member);
		// console.log(member.guild.channels)
		// console.log(member)
		// member.guild.channels.cache.find((c) => c.name == "general").send("Hello <@"+member.id+"> ! ");
	}


	/**
	 * Parses a command entered on chat
	 * @param text 
	 */
	private async parseCommand(message:Discord.Message):Promise<void> {
		let isAdmin = message.member.permissions.has("ADMINISTRATOR");
		
		let txt = message.content.substr(1, message.content.length);
		let chunks = txt.split(/\s/gi);
		let	cmd = chunks[0].toLowerCase();
		let prefix = Config.BOT_NAME.toLowerCase();
		
		if(cmd.indexOf(prefix) != 0) return;
		cmd = cmd.replace(prefix+"-", "");

		switch(cmd) {
			case "help":
				let str = `Voici les commandes disponibles :\`\`\`
!${prefix}-live
Configure un channel comme destination des alertes de live

!${prefix}-roles
Configure un channel comme destination du message de sélection de rôles
\`\`\`
`;
			message.reply(str);
			break;

			case "live":
				if(isAdmin) {
					let channelName = (<any>message.channel).name;
					StorageController.saveData(StorageController.LIVE_CHANNEL, message.channel.id);
					message.reply("Le bot d'alertes de live a bien été configuré sur le channel #"+channelName);
				}else{
					message.reply("Seul un Administrateur peut ajouter le bot à un channel");
				}
				break;

			case "live-del":
				if(isAdmin) {
					let channelName = (<any>message.channel).name;
					StorageController.saveData(StorageController.LIVE_CHANNEL, null);
					message.reply("Le bot d'alertes de live a bien supprimé du channel #"+channelName);
				}else{
					message.reply("Seul un Administrateur peut ajouter le bot à un channel");
				}
				break;

			case "roles":
				if(isAdmin) {
					let channelName = (<any>message.channel).name;
					StorageController.saveData(StorageController.ROLES_CHANNEL, message.channel.id);
					// message.reply("Le bot de gestion de rôles a bien été configuré sur le channel #"+channelName);
					this.sendRolesSelector();
				}else{
					message.reply("Seul un Administrateur peut ajouter le bot à un channel");
				}
				break;

			case "roles-del":
				if(isAdmin) {
					let channelName = (<any>message.channel).name;
					StorageController.saveData(StorageController.ROLES_CHANNEL, null);
					message.reply("Le bot de gestion de rôles a bien supprimé du channel #"+channelName);
				}else{
					message.reply("Seul un Administrateur peut ajouter le bot à un channel");
				}
				break;

		}
	}

	/**
	 * Builds the card that is sent when the suer goes live on twitch
	 * 
	 * @param infos 
	 * @param userInfo 
	 * @param liveMode 
	 * @param offlineMode 
	 * @returns 
	 */
	private buildLiveCard(infos:TwitchStreamInfos, userInfo:TwitchUserInfos, liveMode:boolean, offlineMode:boolean =false):Discord.MessageEmbed {
		if(offlineMode) {
			let url = userInfo.offline_image_url;
			if(!url) {
				url = Config.PUBLIC_SECURED_URL+"/uploads/offline.png";
			}
			infos.thumbnail_url = url.replace("{width}", "1080").replace("{height}", "600");
		}else{
			infos.thumbnail_url = infos.thumbnail_url.replace("{width}", "1080").replace("{height}", "600");
		}

		let card = new Discord.MessageEmbed();
		card.setTitle(infos.title);
		card.setColor("#a970ff");
		card.setURL(`https://twitch.tv/${infos.user_login}`);
		card.setThumbnail(userInfo.profile_image_url);
		card.setImage(infos.thumbnail_url+"?t="+Date.now());
		card.setAuthor("🔴 "+infos.user_name+" est en live !", userInfo.profile_image_url);
		card.addFields(
			{ name: 'Catégorie', value: infos.game_name, inline: false },
		);
		if(liveMode) {
			let ellapsed = Date.now() - new Date(infos.started_at).getTime();
			let uptime:string = Utils.formatDuration(ellapsed);
			if(!this.maxViewersCount[userInfo.id]) this.maxViewersCount[userInfo.id] = 0;
			this.maxViewersCount[userInfo.id] = Math.max(this.maxViewersCount[userInfo.id], infos.viewer_count);
			card.addFields(
				{ name: 'Viewers', value: infos.viewer_count.toString(), inline: true },
				{ name: 'Uptime', value: uptime, inline: true },
			);
			this.lastStreamInfos[userInfo.id] = infos;
		}else if(offlineMode) {
			card.setAuthor(infos.user_name+" était en live !", userInfo.profile_image_url);
			let fields:Discord.EmbedField[] = [];
			if(this.maxViewersCount[userInfo.id]) {
				fields.push({ name: 'Viewers max', value: this.maxViewersCount[userInfo.id].toString(), inline: true });
			}
			let ellapsed = Date.now() - new Date(infos.started_at).getTime();
			let uptime:string = Utils.formatDuration(ellapsed);
			fields.push({ name: 'Durée du stream', value: uptime, inline: true });
			card.addFields( fields );
		}
		card.setFooter(userInfo.description);
		return card;
	}

	/**
	 * Sends the roles selector on the specified channel
	 */
	private async sendRolesSelector():Promise<void> {
		let guild:Discord.Guild = this.client.guilds.cache.entries().next().value[1];
		let roles = guild.roles.cache;
		let emojiList = Config.DISCORDBOT_ROLES_EMOJIS.split(" ");
		let reactionEmojis:string[] = [];
		let message = "Pour t'attribuer un rôle clic sur la réaction correspondante en réponse à ce message !\n";
		let emojiToRole = {};

		roles.forEach(r => {
			if(!r.mentionable) return;
			let e = emojiList.shift();
			emojiToRole[e] = r.id;
			reactionEmojis.push(e);
			message += e + " - " + r.name + "\n";
		});
		message +=  "🗑️ - retirer tous les rôles";
		emojiToRole["🗑️"] = "DELETE_ALL";
		StorageController.saveData(StorageController.ROLES_EMOJIS, emojiToRole);

		//Get channels IDs in which send alerts
		let channelID = StorageController.getData(StorageController.ROLES_CHANNEL);
		if(channelID) {
			//Get actual channel's reference
			let channel = this.client.channels.cache.get(channelID) as Discord.TextChannel;

			const previousMessageID = StorageController.getData(StorageController.ROLES_SELECTOR_MESSAGE);
			let discordMessage:Discord.Message;
			
			if(previousMessageID) {
				//Delete previous message if any
				try {
					let messageToEdit = await channel.messages.fetch(previousMessageID);
					if(messageToEdit) {
						discordMessage = await messageToEdit.edit(message);
					}
				}catch(error) {
					Logger.error("Roles message not found, delete its reference")
					//Message does not exists anymore, remove its reference from storage
					StorageController.saveData(StorageController.ROLES_SELECTOR_MESSAGE, null);
				}
			}
			if(!discordMessage){
				discordMessage = await channel.send(message);
			}
			StorageController.saveData(StorageController.ROLES_SELECTOR_MESSAGE, discordMessage.id);
			reactionEmojis.forEach(async v => {
				try {
					await discordMessage.react(v);
				}catch(error) {
					console.log("Failed ", v);
				}
			});
			await discordMessage.react("🗑️");
		}
		//*/
	}

}