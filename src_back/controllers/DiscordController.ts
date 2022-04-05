import * as Discord from "discord.js";
import { Express } from "express-serve-static-core";
import Config from "../utils/Config";
import { Event, EventDispatcher } from "../utils/EventDispatcher";
import Label from "../utils/Label";
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
	private MAX_REACTIONS:number = 20;//maximum reactions per message allowed by discord
	
	
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
		
		if(Config.TWITCH_USER_ID) {
			this.subToUser();
		}
		
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
				try {

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
				}catch(error) {
					Logger.error("Error while sending message to discord channel " + channelID);
					console.log(error);
				}
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
		if (message.channel.type == "DM") return;
		
		if(message.content.indexOf("!") == 0) this.parseCommand(message);
	}

	/**
	 * Called when someone uses a reaction on a message
	 */
	private async onAddReaction(reaction:Discord.MessageReaction):Promise<void> {
		let messageIDs = StorageController.getData(StorageController.ROLES_SELECTOR_MESSAGES);
		if(messageIDs.indexOf(reaction.message.id) == -1) return;

		let authorId = reaction.message.author.id;
		let users = reaction.users.cache.entries();
		let userId:string;
		let roles:{[key:string]:{id:string, name:string}} = StorageController.getData(StorageController.ROLES_EMOJIS);
		let roleId = roles[reaction.emoji.name]?.id;

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
						answer = await channel.send(Label.get("roles.del_all_ok", [{id:"userId", value:userId}]));
					}else{
						let role = await reaction.message.guild.roles.fetch(roleId);
						if(user.roles.cache.has(role.id)) {
							answer = await channel.send(Label.get("roles.del_one_ok", [{id:"userId", value:userId}, {id:"role", value:role.name}]));
							user.roles.remove(roleId);
						}else{
							answer = await channel.send(Label.get("roles.add_ok", [{id:"userId", value:userId}, {id:"role", value:role.name}]));
							user.roles.add(roleId);
						}
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
		
		let txt = message.content.substring(1);
		let chunks = txt.split(/\s/gi);
		let	cmd = chunks[0].toLowerCase();
		let prefix = Config.BOT_NAME.toLowerCase();
		
		if(cmd.indexOf(prefix) != 0) return;
		cmd = cmd.replace(prefix+"-", "");


		switch(cmd) {
			case "help":
				let str = `${Label.get("help.intro")}
\`\`\`!${prefix}-live
${Label.get("help.cmd_live")}\`\`\`
\`\`\`!${prefix}-roles
${Label.get("help.cmd_roles")}\`\`\`
\`\`\`!${prefix}-poll <question>
<answer 1>
<answer 2>
...
<answer n>
${Label.get("help.cmd_poll")}
\`\`\`
`;
			message.reply(str);
			break;

			case "live":
				if(isAdmin) {
					let channelName = (<any>message.channel).name;
					StorageController.saveData(StorageController.LIVE_CHANNEL, message.channel.id);
					message.reply(Label.get("live.add_ok", [{id:"channel", value:channelName}]));
				}else{
					message.reply(Label.get("live.ko"));
				}
				break;

			case "live-del":
				if(isAdmin) {
					let channelName = (<any>message.channel).name;
					StorageController.saveData(StorageController.LIVE_CHANNEL, null);
					message.reply(Label.get("live.del_ok", [{id:"channel", value:channelName}]));
				}else{
					message.reply(Label.get("live.ko"));
				}
				break;

			case "roles":
				if(isAdmin) {
					StorageController.saveData(StorageController.ROLES_CHANNEL, message.channel.id);
					this.sendRolesSelector();
				}else{
					message.reply(Label.get("roles.ko"));
				}
				break;

			case "roles-del":
				if(isAdmin) {
					let channelName = (<any>message.channel).name;
					StorageController.saveData(StorageController.ROLES_CHANNEL, null);
					message.reply(Label.get("roles.del_ok", [{id:"channel", value:channelName}]));
				}else{
					message.reply(Label.get("roles.ko"));
				}
				break;

			case "poll":
				let options:string[] = txt.replace(prefix+"-poll", "").split(/\r|\n/gi);
				let title = options.splice(0,1)[0];
				this.createPoll(title, options, message);
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
		card.setAuthor(Label.get("twitch_live.online", [{id:"user", value:infos.user_name}]), userInfo.profile_image_url);
		card.addFields(
			{ name: Label.get("twitch_live.category"), value: infos.game_name, inline: false },
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
			card.setAuthor(Label.get("twitch_live.offline", [{id:"user", value:infos.user_name}]), userInfo.profile_image_url);
			let fields:Discord.EmbedField[] = [];
			if(this.maxViewersCount[userInfo.id]) {
				fields.push({ name: Label.get("twitch_live.viewers_max"), value: this.maxViewersCount[userInfo.id].toString(), inline: true });
			}
			let ellapsed = Date.now() - new Date(infos.started_at).getTime();
			let uptime:string = Utils.formatDuration(ellapsed);
			fields.push({ name: Label.get("twitch_live.stream_duration"), value: uptime, inline: true });
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
		let emojiList = Config.DISCORDBOT_REACTION_EMOJIS.split(" ");
		let reactionEmojis:string[] = [];
		let message = Label.get("roles.intro");
		let emojiToRole:{[key:string]:{id:string,name:string}} = {};


		let index = 0;
		roles.forEach(r => {
			if(!r.mentionable) return;
			let e = emojiList.shift();
			emojiToRole[e] = {id:r.id, name:r.name};
			reactionEmojis.push(e);
		});
		emojiToRole["🗑️"] = {id:"DELETE_ALL", name:Label.get("roles.del_all")};
		reactionEmojis.push("🗑️");
		let messagesCount = Math.ceil(reactionEmojis.length/this.MAX_REACTIONS);

		StorageController.saveData(StorageController.ROLES_EMOJIS, emojiToRole);
		//Get channels IDs in which send alerts
		let channelID = StorageController.getData(StorageController.ROLES_CHANNEL);
		let messageIDs = [];
		if(channelID) {
			//Get actual channel's reference
			let channel = this.client.channels.cache.get(channelID) as Discord.TextChannel;
			const previousMessageIDs:string[] = StorageController.getData(StorageController.ROLES_SELECTOR_MESSAGES)?.split(",");

			//If there are more messages than actually necessary, clean them up.
			//This can happen when deleting roles from discord.
			if(previousMessageIDs && previousMessageIDs.length > messagesCount) {
				console.log(previousMessageIDs.length +" VS "+ messagesCount);
				for (let i = messagesCount; i < previousMessageIDs.length; i++) {
					try {
						let m = await channel.messages.fetch(previousMessageIDs[i]);
						await m.delete();
					}catch(error) {}
				}
			}
			
			//Create as much messages as necessary depending on the number of roles VS
			//the maximum reaction count allowed by discord
			do {
				let discordMessage:Discord.Message;
				//Define emojis and text message
				let emojis = reactionEmojis.splice(0, this.MAX_REACTIONS);
				emojis.forEach(e => {
					let role = emojiToRole[e];
					message += e + " - " + role.name + "\n";
				});
				
				if(previousMessageIDs) {
					//Edit previous message if any
					try {
						let messageToEdit = await channel.messages.fetch(previousMessageIDs[index]);
						if(messageToEdit) {
							discordMessage = await messageToEdit.edit(message);
							await discordMessage.reactions.removeAll();
						}
					}catch(error) {
						// Logger.error("Roles message not found")
						discordMessage = null;
					}
				}
				//If no previous message, create a new one
				if(!discordMessage){
					discordMessage = await channel.send(message);
				}

				//Add reactions to the message
				emojis.forEach(async v => {
					try {
						await discordMessage.react(v);
					}catch(error) {
						console.log("Failed ", v);
					}
				});
				index ++;
				message = "";
				messageIDs.push(discordMessage.id);
			}while(reactionEmojis.length > 0);
			StorageController.saveData(StorageController.ROLES_SELECTOR_MESSAGES, messageIDs.join(","));
		}
		//*/
	}

	/**
	 * Creates a poll
	 * @param title poll's title
	 * @param options poll's options
	 */
	private async createPoll(title:string, options:string[], message:Discord.Message):Promise<void> {
		let emojis = Config.DISCORDBOT_REACTION_EMOJIS.split(" ").splice(0, options.length);
		options = options.map((option, index) => emojis[index] + " : "+ option );

		let messagesCount = Math.ceil(options.length/this.MAX_REACTIONS);
		let index = 0;
		do {
			let msg = options.splice(0, this.MAX_REACTIONS).join("\n");
			let t = title;
			let e = emojis.splice(0, this.MAX_REACTIONS);
			if(messagesCount > 1) t += " *("+(index+1)+"/"+messagesCount+")*";
			let discordMessage = await message.channel.send(t+"\n"+msg);

			e.forEach(async v => {
				try {
					await discordMessage.react(v);
				}catch(error) {
					console.log("Failed '"+v+"'");
				}
			});
			index ++;
		}while(options.length > 0);
	}
}