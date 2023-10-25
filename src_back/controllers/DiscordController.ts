import { SlashCommandBuilder } from "@discordjs/builders";
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";
import * as Discord from "discord.js";
import { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { Express } from "express-serve-static-core";
import Config from "../utils/Config";
import { Event, EventDispatcher } from "../utils/EventDispatcher";
import Label from "../utils/Label";
import Logger from '../utils/Logger';
import TwitchUtils, { TwitchTypes } from "../utils/TwitchUtils";
import Utils from "../utils/Utils";
import { AnonPoll, AnonPollOption, StorageController, TwitchLiveMessage, TwitchUser, UniquePoll } from "./StorageController";

/**
* Created : 15/10/2020 
* TODO : split this file into sub modules
*/
export default class DiscordController extends EventDispatcher {

	private client:Discord.Client;
	private maxViewersCount:{[key:string]:number} = {};
	private lastStreamInfos:{[key:string]:TwitchTypes.StreamInfo} = {};
	private refreshTimeouts:{[key:string]:any} = {};

	private MAX_LIST_ITEMS:number = 25;//maximum items per list allowed by discord
	private rest = new REST({ version: '9' }).setToken(Config.DISCORDBOT_TOKEN);
	
	
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
		if(!Config.DISCORDBOT_TOKEN) return;
		
		this.client = new Discord.Client({ intents: [
			Discord.IntentsBitField.Flags.Guilds,
			Discord.IntentsBitField.Flags.GuildMembers,
			Discord.IntentsBitField.Flags.GuildMessages,
			Discord.IntentsBitField.Flags.MessageContent,
			Discord.IntentsBitField.Flags.DirectMessages,
			Discord.IntentsBitField.Flags.GuildMessageReactions,
			Discord.IntentsBitField.Flags.DirectMessageReactions,
		] });

		//Called when API is ready
		this.client.on("ready", ()=> this.onReady());
		this.client.on("messageCreate", (message) => this.onMessage(message));
		//Called when using a /command
		this.client.on("interactionCreate", (interaction) => this.onCommand(interaction))
		//Called when a reaction is added to a message
		this.client.on("messageReactionAdd", (reaction, user) => this.onAddReaction(reaction as Discord.MessageReaction, user as Discord.User));
		//Called when a reaction is removed from a message
		this.client.on("messageReactionRemove", (reaction) => this.onRemoveReaction(reaction as Discord.MessageReaction));
		//Called when a new member joins the server
		this.client.on("guildMemberAdd", (member) => this.onAddMember(member))
		this.client.on("guildMemberRemove", (member) => this.onRemoveMember(member))
		//Called when bot is added to a new discord
		// this.client.on("guildCreate", (guild) => this.installCommands(guild) );
		//Called when bot is kicked out a discord
		this.client.on("guildDelete", (guild) => StorageController.deleteStore(guild.id) );

		try {
			await this.client.login(Config.DISCORDBOT_TOKEN);
		}catch(error) {
			Logger.error("Invalid discord token !");
			console.log(error);
		}
		this.listenForReactions();

		/*
		//Add commands to all guilds the bot is installed on
		const guilds = this.client.guilds.cache.entries();
		do {
			//Add commands to current guild
			const guildLocal = guilds.next();
			if(guildLocal.done) break;

			//If adding command to one specific discord, ignore the others
			this.installCommands(guildLocal.value[1]);
		}while(true);
		Logger.success("Commands added to all guilds");
		//*/
		this.cronTask();
	}

	private async cronTask():Promise<void> {
		let d = new Date();
		d.setMilliseconds(0);
		d.setSeconds(0);
		d.setMinutes(0);
		d.setHours(d.getHours()+1);
		//Schedule next task for the next round hour
		setTimeout(()=> {
			this.cronTask();
		}, d.getTime() - Date.now());

		try {
			//Get all guilds refs
			const guilds = this.client.guilds.cache.entries();
			const today = new Date();
			today.setHours(today.getHours() + Config.TIMEZONE_OFFSET);
			const todayDay = today.getDate();
			const todayMonth = today.getMonth() + 1;
			const todayYear = today.getFullYear();


			do {
				const guildPointer = guilds.next();
				if(guildPointer.done) break;
				//get actual guild ref
				const guild = guildPointer.value[1] as Discord.Guild;
				const lang = this.lang(guild.id);
				const birthdays:BirthdayCollection = StorageController.getData(guild.id, StorageController.BIRTHDAYS);
				const chanId = StorageController.getData(guild.id, StorageController.BIRTHDAY_CHANNEL);
				const channel = await guild.channels.fetch(chanId) as Discord.TextChannel;

				if(!channel || !birthdays) continue;

				for (const uid in birthdays) {
					const b = birthdays[uid];
					//Check if today is the birthday and the alert hasn't been sent for this year
					if(b.day == todayDay && b.month == todayMonth
					&& channel && channel.send
					&& (!b.lastAlert || new Date(b.lastAlert).getFullYear() != todayYear)) {
						channel.send(Label.get(lang, "birthday.alert", [{id:"user", value:uid}]));
						b.lastAlert = Date.now();
					}
				}

				StorageController.setData(guild.id, StorageController.BIRTHDAYS, birthdays);
			}while(true);
		}catch(error) {
			//ignore errors
		}
	}

	/**
	 * Sends a message to warn that a user went live on twitch
	 */
	public async alertLiveChannel(uid:string, recursive:boolean =false):Promise<void> {
		clearTimeout(this.refreshTimeouts[uid]);
		const guilds = this.client.guilds.cache.entries();
		//Go through all guilds and check where the user should be notified
		while(true) {
			const guildI = guilds.next();
			if(guildI.done) break;
			const guild:Discord.Guild = guildI.value[1];

			const users:TwitchUser[] = StorageController.getData(guild.id, StorageController.TWITCH_USERS);
			if(!users) return;
			let userInfos = await TwitchUtils.loadChannelsInfo(null, [uid]);
			let userInfo = userInfos[0];
			for (let i = 0; i < users.length; i++) {
				const user = users[i];
				if(user.uid != uid) continue;

				let editedMessage :Discord.Message|null = null;
				const channel = this.client.channels.cache.get(user.channel) as Discord.TextChannel;
				const historyKey = user.uid +"_"+user.channel+"_"+guild.id;
				
				let usersStorage:{[key:string]:TwitchLiveMessage} = StorageController.getData("global", StorageController.TWITCH_LIVE_CARD);
				if(!usersStorage) usersStorage = {};
				const messageHistory = usersStorage[historyKey];
				//Search for the last message sent by the bot for this user on this channel
				//and update it if it's not older than 30min
				if(messageHistory && messageHistory.date > Date.now() - 30 * 60 * 1000) {
					try {
						editedMessage = await channel.messages.fetch(messageHistory.messageId);
					}catch(error) {
						editedMessage = null;
					}

				}else if(messageHistory) {
					//If there's an old message but it's older than 1h, reset infos
					delete this.lastStreamInfos[userInfo.id];
					delete this.maxViewersCount[userInfo.id];
				}

				let res = await TwitchUtils.getStreamsInfos(null, [uid]);
				let streamDetails = res[0];
				if(!streamDetails) {
					if(editedMessage) {
						//user closed his/her stream, replace the stream picture by the offline one
						let card = this.buildLiveCard(guild.id, this.lastStreamInfos[userInfo.id], userInfo, false);
						await editedMessage.edit({embeds:[card]});
					}
					return;
				}
				
				if(channel) {
					try {
						//Get twitch channel's infos
						let card = this.buildLiveCard(guild.id, streamDetails, userInfo);
						let message:Discord.Message;
						if(editedMessage) {
							//Edit existing message
							message = editedMessage;
							message = await message.edit({embeds:[card]});
							
							//Update the date on all the entries of the user on the global storage
							const liveItem = usersStorage[historyKey];
							liveItem.date = Date.now();
							StorageController.setData("global", StorageController.TWITCH_LIVE_CARD, usersStorage);
						}else{
							//Send new message
							message = await channel.send({embeds:[card]});

							//Add a new live entry for this user on the global storage
							usersStorage[historyKey] = {
								date:Date.now(),
								messageId:message.id,
							};
							StorageController.setData("global", StorageController.TWITCH_LIVE_CARD, usersStorage);
						}

						//Schedule message update 1min later
						this.refreshTimeouts[uid] = setTimeout(_=> {
							this.alertLiveChannel(uid, true);
						}, 1 * 60 * 1000);
					}catch(error) {
						Logger.error("Error while sending message to discord channel " + user.channel);
						console.log(error);
					}
				}else{
					Logger.error("Twitch allert: channel not found");
				}
			}
		}
	}
	
	
	
	/*******************
	* PRIVATE METHODS *
	*******************/
	private async onReady():Promise<void> {
		Logger.success("Discord bot connected");
		// let channelID = StorageController.getData(StorageController.ROLES_CHANNEL);
		// if(channelID) {
		// 	//Forces refresh of the message so we can receive reactions even
		// 	//after a reboot of the server
		// 	this.sendRolesSelector();
		// }
	}

	/**
	 * Gets the locale configured for the specified guild
	 */
	private lang(guildId:string):string {
		const lang = StorageController.getData(guildId, StorageController.LANGUAGE);
		if(!lang) return Label.getLocales()[0].id;
		return lang;
	}

	/**
	 * Listens for reactions on anon polls.
	 * When server reboots all reaction events are lost, we need
	 * to subscribe back manually
	 */
	private async listenForReactions():Promise<void> {
		//Add commands to all guilds the bot has been added to
		const guilds = this.client.guilds.cache.entries();
		while(true) {
			//Add commands to current guild
			const guildLocal = guilds.next();
			if(guildLocal.done) break;
			const guild = guildLocal.value[1] as Discord.Guild;
			await guild.fetch();
			
			//Loads up all the polls messages in cache so we can receive
			//the reactions
			const anonPolls:AnonPoll[] = StorageController.getData(guild.id, StorageController.ANON_POLLS);
			const uniquePolls:UniquePoll[] = StorageController.getData(guild.id, StorageController.UNIQUE_POLLS);

			//Listen for anon polls reactions
			if(anonPolls?.length > 0) {
				for (let i = 0; i < anonPolls.length; i++) {
					const poll = anonPolls[i];
					const chan = await guild.channels.cache.get(poll.chan)?.fetch() as Discord.TextChannel;
					try {
						//Simply load the message in cache to receive the reactions updates
						await chan.messages.fetch(poll.id);
					}catch(err) {
						//Cleanup the poll from storage
						anonPolls.splice(i,1);
						i--;
					}
				}
				StorageController.setData(guild.id, StorageController.ANON_POLLS, anonPolls);
				Logger.success(anonPolls.length + " anon polls listened successfully");
			}
			
			//Listen for unique votes reactions
			if(uniquePolls?.length > 0) {
				for (let i = 0; i < uniquePolls.length; i++) {
					const poll = uniquePolls[i];
					const chan = await guild.channels.cache.get(poll.chan)?.fetch() as Discord.TextChannel;
					try {
						//Simply load the message in cache to receive the reactions updates
						await chan.messages.fetch(poll.id);
					}catch(err) {
						//Cleanup the poll from storage
						console.log(err);
						uniquePolls.splice(i,1);
						i--;
					}
				}
				StorageController.setData(guild.id, StorageController.UNIQUE_POLLS, uniquePolls);
				Logger.success(uniquePolls.length + " unique vote polls listened successfully");
			}
		}
	}

	/**
	 * Called when a command is executed
	 * 
	 * @param interaction 
	 * @returns 
	 */
	private async onCommand(interaction:Discord.Interaction<Discord.CacheType>):Promise<void> {
		let lang = this.lang(interaction.guildId as string);
		let user = await interaction.guild?.members.fetch(interaction.user.id);
		if(interaction.isButton() && user) {
			let [action, params] = interaction.customId.split(":");
			switch(action){
				case "roles_delete_all": {
					await interaction.deferReply();
					//Delete all roles of the user
					let roleDeleted = false;
					const users = user.roles.cache.entries();
					while(true) {
						const v = users.next();
						if(v.done) break;
						const role = v.value[1];
						if(role.editable && role.id != interaction.guildId) {
							roleDeleted = true;
							try {
								if(role.id)
								await user.roles.remove( role.id );
							}catch(error) {
								Logger.error("Failed removing", role.name)
							}
						}
					}

					const m = await interaction.editReply(Label.get(lang, "roles.del_all_ok", [{id:"user", value:user.id}]));
					await Utils.promisedTimeout(10000);
					if(m.type == Discord.MessageType.Reply) await m.delete();
					break;
				}

				case "support_create": {
					await this.createSupport(interaction);
					break;
				}

				case "role_selector":{
					await interaction.deferReply({ephemeral:true});
					const role = interaction.guild?.roles.cache.get(params);
					const roleName = role?.name ?? "role not found";
					if(user.roles.cache.has(params)) {
						await user.roles.remove( params );
						interaction.editReply(Label.get(lang, "roles.del_ok", [{id:"role", value:roleName}]));
					}else{
						await user.roles.add( params );
						interaction.editReply(Label.get(lang, "roles.add_ok", [{id:"role", value:roleName}]));
					}
				}
			}
		}
			
		if(interaction.isAnySelectMenu() && user) {
			const cmd = interaction as Discord.ButtonInteraction | Discord.SelectMenuInteraction;
			let [action, params] = cmd.customId.split(":");
			switch(action) {
				case "install_selector":{
					await interaction.deferUpdate();
					if(cmd.guild) await this.installCommands(cmd.guild, cmd as Discord.SelectMenuInteraction);
					//Reset menu selection
					await interaction.editReply({ content: interaction.message.content});
					break;
				}
			}
		}

		//If it's a command execution
		if(interaction.isCommand()) {
			const cmd = interaction as Discord.ChatInputCommandInteraction;
			let action = cmd.commandName;
			try {
				const subCommand = cmd.options.getSubcommand();
				if(subCommand) action += "/" + subCommand;
			}catch(error) {}
			
			action = action.replace(new RegExp("^"+Config.CMD_PREFIX, "i"), "");
			Logger.info("Execute action", "\""+action+"\"");
	
			switch(action) {
				case "admin/language": {
					await cmd.deferReply({ephemeral:true});
					lang = cmd.options.get("lang")?.value as string;
					StorageController.setData(cmd.guildId as string, StorageController.LANGUAGE, lang);
					cmd.editReply(Label.get(lang, "admin.language_updated"));
					break;
				}
				
				case "admin/birthday_target": {
					await cmd.deferReply({ephemeral:true});
					StorageController.setData(cmd.guildId as string, StorageController.BIRTHDAY_CHANNEL, cmd.channelId);
					cmd.editReply(Label.get(lang, "admin.birthday_chan_ok"));
					break;
				}
				
				case "admin/birthday_remove": {
					await cmd.deferReply({ephemeral:true});

					const lang = this.lang(cmd.guildId as string);
					
					let userID = cmd.options.get("user_id")?.value as string;
					const user = cmd.options.getMember("user") as Discord.GuildMember;
					if(user) userID = user.id;
					
					if(userID) {
						let birthdays:BirthdayCollection = StorageController.getData(cmd.guildId as string, StorageController.BIRTHDAYS);
						if(!birthdays) birthdays = {};
						delete birthdays[userID];
						StorageController.setData(cmd.guildId as string, StorageController.BIRTHDAYS, birthdays);
						cmd.editReply( Label.get(lang, "commands.admin.birthday_remove.success"));
					}else{
						cmd.editReply( Label.get(lang, "commands.admin.birthday_remove.user_not_found"));
					}

					break;
				}
				
				case "admin/leave_notification": {
					await cmd.deferReply({ephemeral:true});
					const chan = cmd.options.get("channel")?.channel;
					const disable = cmd.options.get("disable")?.value as boolean;
					if(disable) {
						StorageController.delData(cmd.guildId as string, StorageController.LEAVE_CHANNEL);
						cmd.editReply(Label.get(lang, "admin.leave_chan_disabled"));
					}else{
						if(chan?.type == Discord.ChannelType.GuildText) {
							StorageController.setData(cmd.guildId as string, StorageController.LEAVE_CHANNEL, cmd.channelId);
							cmd.editReply(Label.get(lang, "admin.leave_chan_ok", [{id:"target", value:chan.id}]));
						}else if(chan){
							cmd.editReply(Label.get(lang, "admin.leave_chan_ko", [{id:"target", value:chan.id}]));
						}
					}
					break;
				}
	
				case "support/target": {
					await cmd.deferReply({ephemeral:true});
					const chan = cmd.options.get("category")?.channel;
					if(chan?.type == Discord.ChannelType.GuildCategory) {
						StorageController.setData(cmd.guildId as string, StorageController.SUPPORT_TARGET, chan.id);
						cmd.editReply(Label.get(lang, "support.configure_success", [{id:"target", value:chan.id}]));
					}else if(chan){
						cmd.editReply(Label.get(lang, "support.invalid_chan_type", [{id:"target", value:chan.id}]));
					}
					break;
				}
	
				case "support/form": {
					await this.sendSupportForm(cmd);
					break;
				}
	
				case "roles_selector": {
					await this.sendRolesSelector(cmd);
					break;
				}
				
				case "twitch": {
					return this.twitchLiveAlertChannel(cmd);
				}
				
				case "poll": {
					this.createPoll(cmd);
					break;
				}
				
				case "birthday": {
					this.setBirthday(cmd);
					break;
				}
				
				case "inactivity": {
					this.saveInactivityParams(cmd);
					break;
				}
			}
		}
	}

	/**
	 * Called when someone sends a message to a channel
	 * 
	 * @param message 
	 */
	private async onMessage(message:Discord.Message):Promise<void> {
		// console.log("Message received : ", message.author.bot, message.channel.type, message.content);
		if (message.author.bot) return;
		if (message.channel.type == Discord.ChannelType.DM) return;
		
		if(message.content.indexOf("!") == 0) this.parseCommand(message);
	}

	/**
	 * Parses a command entered on chat
	 * @param text 
	 */
	private async parseCommand(message:Discord.Message):Promise<void> {
		let isAdmin = message.member?.permissions.has(Discord.PermissionFlagsBits.Administrator);
		let txt = message.content.substring(1);
		let chunks = txt.split(/\s/gi);
		let	cmd = (chunks.shift() as string).toLowerCase();
		let prefix = Config.BOT_NAME.toLowerCase();
		
		if(cmd.indexOf(prefix) != 0) return;
		cmd = cmd.replace(prefix+"-", "");

		switch(cmd) {
			case "install": {
				if(!isAdmin) return;
				await this.sendInstallCard(message);
				break;
			}
			case "test": {
				const lang = this.lang(message.guildId as string);
				const chanName = Label.get(lang, "support.channel_name", [{id:"user", value:message.member?.displayName as string}]);
				console.log(lang, Label.get(lang, "support.channel_name"), chanName, message.member?.displayName);
				const chan = await message.guild?.channels.create({ 
					name:chanName,
					type: Discord.ChannelType.GuildText,
					permissionOverwrites: [{
						id: message.guild.id,
						allow: [Discord.PermissionsBitField.Flags.Administrator],
						deny: [Discord.PermissionsBitField.Flags.ViewChannel],
					}]
				});
				if(chan) {
					chan.permissionOverwrites.create(message.member as Discord.GuildMember, {ViewChannel:true});
				}
				message.channel.send("Channel Created!");
				break;
			}
			case "test-live": {
				if(!isAdmin) return;
				const userInfos = await TwitchUtils.loadChannelsInfo([chunks[0]]);
				if(userInfos.length == 0) {
					message.reply("Twitch user not found");
					return;
				}
	
				const user = userInfos[0];
				const streamInfos = await TwitchUtils.getStreamsInfos(null, [user.id]);
				if(streamInfos.length == 0) {
					message.reply("Twitch user is not live");
					return;
				}
				
				const streamDetails = streamInfos[0];
				let card = this.buildLiveCard(message.guildId as string, streamDetails, user, true);
				await message.channel.send({embeds:[card]});
				break;
			}
		}
	}

	/**
	 * Called when someone uses a reaction on a message
	 */
	private async onAddReaction(reaction:Discord.MessageReaction, userOrigin:Discord.User):Promise<void> {
		const anonPolls = StorageController.getData(reaction.message.guildId as string, StorageController.ANON_POLLS) as AnonPoll[];
		const uniquePoll = StorageController.getData(reaction.message.guildId as string, StorageController.UNIQUE_POLLS) as UniquePoll[];
		let anonVote:AnonPoll|undefined = anonPolls?.find(v=> v.id === reaction.message.id);
		let uniqueVote:UniquePoll|undefined = uniquePoll?.find(v=> v.id === reaction.message.id);
		// console.log("ADD REACTION");
		// console.log(anonVote);
		// console.log(uniqueVote);

		if(anonVote){
			//Found an anon poll matching the reaction source
			const users = reaction.users.cache.entries();
			while(true){
				const user = users.next();
				let update = false;
				if(user.done) break;
				if(user.value[0] === reaction.message.author?.id) continue;
				anonVote.opt.forEach(option=> {
					if(option.e === reaction.emoji.name) {
						if(option.v.indexOf(user.value[0]) == -1) {
							option.v.push(user.value[0]);
							update = true;
						}else{
							const index = option.v.indexOf(user.value[0]);
							option.v.splice(index, 1);
							update = true;
						}
					}else if(anonVote!.unique === true && option.v.indexOf(user.value[0]) > -1) {
						const index = option.v.indexOf(user.value[0]);
						option.v.splice(index, 1);
						update = true;
					}
				});
				if(update) {
					const lang = this.lang(reaction.message.guildId as string);
					this.updateAnonPoll(anonVote, reaction, lang);
				}
				reaction.users.remove(user.value[0]);
			}
			StorageController.setData(reaction.message.guildId as string, StorageController.ANON_POLLS, anonPolls);
		}else

		if(uniqueVote) {
			const list = reaction.message.reactions.cache.entries();
			while(true) {
				const item = list.next();
				if(item.done) break;
				const r = item?.value[1];
				if(r.emoji.name != reaction.emoji.name) {
					const users = (await r.users.fetch()).entries();
					while(true) {
						const u = users.next();
						if(u.done) break;
						if(u.value[0] == userOrigin.id) {
							r.users.remove(u.value[0]);

						}
					} 
				}
			}
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
	 * Called when someone leaves the discord server
	 * @param member 
	 */
	private async onRemoveMember(member:Discord.GuildMember | Discord.PartialGuildMember):Promise<void> {
		const leaveChan = StorageController.LEAVE_CHANNEL;
		if(!leaveChan) return;
		
		Logger.info("Member left !", member.user.tag);
		const lang = this.lang(member.guild.id);
		const chanId = StorageController.getData(member.guild.id, StorageController.LEAVE_CHANNEL);
		const channel = await member.guild.channels.fetch(chanId) as Discord.TextChannel;
		if(channel && channel.send){
			channel.send(Label.get(lang, "admin.leave_chan_notification", [{id:"user", value:member.user.tag}]));
		}
	}

	/**
	 * Sends the install card to allow enabling features as commands
	 * @param message 
	 */
	private async sendInstallCard(message:Discord.Message):Promise<void> {
		const lang = this.lang(message.guildId as string);

		const listItems:Discord.SelectMenuComponentOptionData[] = [];
		listItems.push( { label: Label.get(lang, "admin.install.all.label"),		value: "all",				description:Label.get(lang, "admin.install.all.description") } );
		listItems.push( { label: Label.get(lang, "admin.install.admin.label"),		value: "admin_commands",	description:Label.get(lang, "admin.install.admin.description") } );
		listItems.push( { label: Label.get(lang, "admin.install.roles.label"),		value: "roles_selector",	description:Label.get(lang, "admin.install.roles.description") } );
		listItems.push( { label: Label.get(lang, "admin.install.support.label"),	value: "support",			description:Label.get(lang, "admin.install.support.description") } );
		listItems.push( { label: Label.get(lang, "admin.install.twitch.label"),		value: "twitch_live",		description:Label.get(lang, "admin.install.twitch.description") } );
		listItems.push( { label: Label.get(lang, "admin.install.poll.label"),		value: "poll",				description:Label.get(lang, "admin.install.poll.description") } );
		listItems.push( { label: Label.get(lang, "admin.install.birthday.label"),	value: "birthday",			description:Label.get(lang, "admin.install.birthday.description") } );
		// listItems.push( { label: Label.get(lang, "admin.install.inactivity.label"),	value: "inactivity",		description:Label.get(lang, "admin.install.inactivity.description") } );
		listItems.push( { label: Label.get(lang, "admin.install.remove.label"),		value: "remove_all",		description:Label.get(lang, "admin.install.remove.description") } );

		const list = new Discord.StringSelectMenuBuilder()
			.setCustomId('install_selector')
			.setPlaceholder( Label.get(lang, "admin.install.selector_placeholder") )
			.setMinValues(1)
			.setMaxValues(listItems.length)
			.addOptions(listItems);
		
		const row = new Discord.ActionRowBuilder<Discord.StringSelectMenuBuilder>()
		.addComponents(list);

		await message.channel.send({content:Label.get(lang, "admin.install.intro"), components:[row]});
	}

	/**
	 * Creates the bot's commands and add them to the specified guild
	 */
	private async installCommands(guild:Discord.Guild, cmd:Discord.SelectMenuInteraction):Promise<void> {
		const langChoices:{   
			name: string,
			value: string,
		}[] = [];
		const langChoicesRaw:string[] = [];
		const locales = Label.getLocales();
		for (let i = 0; i < locales.length; i++) {
			const l = locales[i];
			langChoicesRaw.push(l.name, l.id);
			langChoices.push({
				name:l.name,
				value:l.id
			});
		}

		console.log("INSTALL COMMANDS");

		const lang = this.lang(guild.id);
		
		const roles = new SlashCommandBuilder()
			.setDefaultMemberPermissions(Discord.PermissionsBitField.Flags.Administrator)
			.setName(Config.CMD_PREFIX+'roles_selector')
			.setDescription(Label.get(lang, "commands.role_selector.description"));
			
		for (let i = 1; i <= 20; i++) {
			roles.addRoleOption((option) => {
				option.setName('role'+i)
				.setDescription(Label.get(lang, "commands.role_selector.role", [{id:"X", value:i.toString()}]))
				if(i == 1) {
					option.setRequired(true);
				}
				return option;
			})
		}
		
		const admin = new SlashCommandBuilder()
			.setDefaultMemberPermissions(Discord.PermissionsBitField.Flags.Administrator)
			.setName(Config.CMD_PREFIX+'admin')
			.setDescription(Label.get(lang, "commands.admin.description"))
			.addSubcommand(subcommand =>
				subcommand
					.setName('language')
					.setDescription(Label.get(lang, "commands.admin.language.description"))
					.addStringOption(option => {
							option.setRequired(true)
							.setName('lang')
							.setDescription(Label.get(lang, "commands.admin.language.param"));
							for (let i = 0; i < langChoices.length; i++) {
								option.addChoices(langChoices[i])
							}
							return option;
						}
					)
			)
			.addSubcommand(subcommand =>
				subcommand
					.setName('birthday_target')
					.setDescription(Label.get(lang, "commands.admin.birthday"))
			)
			.addSubcommand(subcommand =>
				subcommand
					.setName('birthday_remove')
					.setDescription(Label.get(lang, "commands.admin.birthday_remove.description"))
					.addUserOption(option => option.setName("user").setDescription(Label.get(lang, "commands.admin.birthday_remove.user")))
					.addStringOption(option => option.setName("user_id").setDescription(Label.get(lang, "commands.admin.birthday_remove.user_id")))
			)
			.addSubcommand(subcommand =>
				subcommand
					.setName('leave_notification')
					.setDescription(Label.get(lang, "commands.admin.leave.description"))
					.addChannelOption(option =>
						option.setName('channel')
						.setDescription(Label.get(lang, "commands.admin.leave.param"))
					)
					.addBooleanOption(option => option.setName('disable').setDescription(Label.get(lang, "commands.admin.leave.disable")))
			);
			
		
		const inactivity = new SlashCommandBuilder()
			.setDefaultMemberPermissions(Discord.PermissionsBitField.Flags.Administrator)
			.setName(Config.CMD_PREFIX+'inactivity')
			.setDescription(Label.get(lang, "commands.admin.inactivity.description"))
			.addNumberOption(option => option.setRequired(true).setName('days').setDescription(Label.get(lang, "commands.admin.inactivity.days")))
			.addNumberOption(option => option.setName('days_warn').setDescription(Label.get(lang, "commands.admin.inactivity.days_warn")))
			.addBooleanOption(option => option.setName('disable').setDescription(Label.get(lang, "commands.admin.inactivity.disable")))
			.addRoleOption(option => option.setName('role_add_1').setDescription(Label.get(lang, "commands.admin.inactivity.role_add")))
			.addRoleOption(option => option.setName('role_add_2').setDescription(Label.get(lang, "commands.admin.inactivity.role_add")))
			.addRoleOption(option => option.setName('role_add_3').setDescription(Label.get(lang, "commands.admin.inactivity.role_add")))
			.addRoleOption(option => option.setName('role_add_4').setDescription(Label.get(lang, "commands.admin.inactivity.role_add")))
			.addRoleOption(option => option.setName('role_add_5').setDescription(Label.get(lang, "commands.admin.inactivity.role_add")))
			.addRoleOption(option => option.setName('role_del_1').setDescription(Label.get(lang, "commands.admin.inactivity.role_del")))
			.addRoleOption(option => option.setName('role_del_2').setDescription(Label.get(lang, "commands.admin.inactivity.role_del")))
			.addRoleOption(option => option.setName('role_del_3').setDescription(Label.get(lang, "commands.admin.inactivity.role_del")))
			.addRoleOption(option => option.setName('role_del_4').setDescription(Label.get(lang, "commands.admin.inactivity.role_del")))
			.addRoleOption(option => option.setName('role_del_5').setDescription(Label.get(lang, "commands.admin.inactivity.role_del")));

		const twitch = new SlashCommandBuilder()
			.setDefaultMemberPermissions(Discord.PermissionsBitField.Flags.Administrator)
			.setName(Config.CMD_PREFIX+'twitch')
			.setDescription(Label.get(lang, "commands.twitch.description"))
			.addStringOption(option => option.setRequired(false).setName('watch_login').setDescription(Label.get(lang, "commands.twitch.watch")))
			.addStringOption(option => option.setRequired(false).setName('unwatch_login').setDescription(Label.get(lang, "commands.twitch.unwatch")))
		
		const poll = new SlashCommandBuilder()
			.setName(Config.CMD_PREFIX+'poll')
			.setDescription(Label.get(lang, "commands.poll.description"))
			.addStringOption(option => option.setRequired(true).setName('title').setDescription(Label.get(lang, "commands.poll.title")))
			.addStringOption(option => option.setRequired(true).setName('option1').setDescription(Label.get(lang, "commands.poll.option", [{id:"X", value:"1"}])))
			.addStringOption(option => option.setRequired(true).setName('option2').setDescription(Label.get(lang, "commands.poll.option", [{id:"X", value:"2"}])))
			.addStringOption(option => option.setName('emote1').setDescription(Label.get(lang, "commands.poll.emote", [{id:"X", value:"1"}])))
			.addStringOption(option => option.setName('emote2').setDescription(Label.get(lang, "commands.poll.emote", [{id:"X", value:"2"}])))
			.addBooleanOption(option => option.setName('anonvotes').setDescription(Label.get(lang, "commands.poll.anon")))
			.addBooleanOption(option => option.setName('unique').setDescription(Label.get(lang, "commands.poll.unique")));
		for (let i = 3; i <= 8; i++) {
			poll.addStringOption(option => option.setName('option'+i).setDescription(Label.get(lang, "commands.poll.option", [{id:"X", value:i.toString()}])))
			poll.addStringOption(option => option.setName('emote'+i).setDescription(Label.get(lang, "commands.poll.emote", [{id:"X", value:i.toString()}])))
		}

		const birthday = new SlashCommandBuilder()
			.setName(Config.CMD_PREFIX+'birthday')
			.setDescription(Label.get(lang, "commands.birthday.description"))
			.addStringOption(option => option.setRequired(true).setName('date').setDescription(Label.get(lang, "commands.birthday.option")))

		const support = new SlashCommandBuilder()
			.setDefaultMemberPermissions(Discord.PermissionsBitField.Flags.Administrator)
			.setName(Config.CMD_PREFIX+'support')
			.setDescription(Label.get(lang, "commands.support.description"))
			.addSubcommand(subcommand =>
				subcommand
					.setName('target')
					.setDescription(Label.get(lang, "commands.support.target.description"))
					.addChannelOption(option => option.setRequired(true).setName('category').setDescription(Label.get(lang, "commands.support.target.option")))
			)
			.addSubcommand(subcommand =>
				subcommand
				.setName('form')
				.setDescription(Label.get(lang, "commands.support.cta.description"))
				.addStringOption(option => option.setRequired(true).setName('intro').setDescription(Label.get(lang, "commands.support.cta.option")))
			);


		const list:RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
		const all =  cmd.values.indexOf("all") > -1;
		if(all || cmd.values.indexOf("admin_commands") > -1)	list.push(admin.toJSON());
		if(all || cmd.values.indexOf("support") > -1)			list.push(support.toJSON());
		if(all || cmd.values.indexOf("roles_selector") > -1)	list.push(roles.toJSON());
		if(all || cmd.values.indexOf("poll") > -1)				list.push(poll.toJSON());
		if(all || cmd.values.indexOf("twitch_live") > -1)		list.push(twitch.toJSON());
		if(all || cmd.values.indexOf("birthday") > -1)			list.push(birthday.toJSON());
		// if(all || cmd.values.indexOf("inactivity") > -1)		list.push(inactivity.toJSON());

		Logger.log("Adding ", list.length, " commands");
		
		await this.rest.put(
			Routes.applicationGuildCommands(Config.DISCORDBOT_CLIENT_ID, guild.id),
			{ body: list },
		);
		
		/*
		//Allow admins to use all commands
		let members = await guild.members.fetch();
		let commands = (await guild.commands.fetch()).toJSON();
		const admins = members.filter(v => v.permissions.has("ADMINISTRATOR")).toJSON();
		
		for (let h = 0; h < admins.length; h++) {
			const admin = admins[h];
			
			for (let i = 0; i < commands.length; i++) {
				const command = commands[i];
				if(command.defaultPermission) continue;//If it's a public command, no need to add permissions
				//Remove all users
				// const perms = command.permissions;
				// await perms.remove({users: members.map(v=>v.user.id)});
				const permissions = [
					{
						id: admin.user.id,
						type: ApplicationCommandPermissionTypes.USER,
						permission: true,
					},
				];

				await command.permissions.add({ permissions });
			}
		}
		//*/
		if(cmd?.channel && cmd.channel.send) {
			await cmd.channel.send(Label.get(lang, "admin.install.done"));
		}
	}

	/**
	 * Start watching for a twitch user to go live
	 */
	private async twitchLiveAlertChannel(cmd:Discord.CommandInteraction):Promise<void> {
		let watch:boolean = false;
		let key = "";
		if(cmd.options.get("watch_login")) {
			watch = true;
			key = "watch_login";
		}
		if(cmd.options.get("unwatch_login")) {
			watch = false;
			key = "unwatch_login";
		}
		
		const lang = this.lang(cmd.guildId as string);

		if(key === "") {
			const users:TwitchUser[] = StorageController.getData(cmd.guildId as string, StorageController.TWITCH_USERS);
			const userNames = users.map(v=>"\n ⚈ **" + v.login + "** => <#" + v.channel + ">");
			const message = Label.get(lang, "twitch.user_list") + userNames;
			cmd.reply({content:message, ephemeral:true});
			return;
		}

		if(!Config.IS_TWITCH_CONFIGURED) {
			cmd.reply({content:Label.get(lang, "twitch.not_configured"), ephemeral:true});
			return;
		}
		const user = cmd.options.get(key)?.value as string;
		const userRes = await TwitchUtils.loadChannelsInfo([user]);
		if(userRes.length>0) {
			const user = userRes[0];
			let list = StorageController.getData(cmd.guildId as string, StorageController.TWITCH_USERS);
			if(!list) list = [];
			if(watch) {
				if(list.findIndex(v=>v.uid==user.id && v.channel==cmd.channelId) == -1) {
					list.push({uid:user.id, login:user.login, channel:cmd.channelId});
				}
			}else{
				const index = list.findIndex(v=>v.uid==user.id);
				if(index > -1) list.splice(index, 1);
			}
			StorageController.setData(cmd.guildId as string, StorageController.TWITCH_USERS, list);
			if(watch) {
				cmd.reply({content:Label.get(lang, "twitch.user_added", [{id:"user", value:user.display_name}]), ephemeral:true});
				this.dispatchEvent(new Event(Event.SUB_TO_LIVE_EVENT, user.id));
			}else{
				cmd.reply({content:Label.get(lang, "twitch.user_removed", [{id:"user", value:user.display_name}]), ephemeral:true});
				this.dispatchEvent(new Event(Event.UNSUB_FROM_LIVE_EVENT, user.id));
			}
		}else{
			cmd.reply({content:Label.get(lang, "twitch.user_notFound", [{id:"user", value:user}]), ephemeral:true});
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
	private buildLiveCard(guildId:string, infos:TwitchTypes.StreamInfo, userInfo:TwitchTypes.UserInfo, onlineMode:boolean = true):Discord.EmbedBuilder {
		const lang = this.lang(guildId);
		if(!onlineMode) {
			let url = userInfo.offline_image_url;
			if(!url) {
				url = Config.PUBLIC_SECURED_URL+"uploads/offline.png";
			}
			infos.thumbnail_url = url.replace("{width}", "1080").replace("{height}", "600");
		}else{
			infos.thumbnail_url = infos.thumbnail_url.replace("{width}", "1080").replace("{height}", "600");
		}

		const url = `https://twitch.tv/${infos.user_login}`;
		const author = {
			url: url,
			name: Label.get(lang, "twitch_live.online", [{id:"user", value:infos.user_name}]),
			iconURL: userInfo.profile_image_url,
		}

		let card = new Discord.EmbedBuilder();
		card.setTitle(infos.title);
		card.setColor("#a970ff");
		card.setURL(url);
		card.setThumbnail(userInfo.profile_image_url);
		card.setImage(infos.thumbnail_url+"?t="+Date.now());
		card.setAuthor(author);
		card.addFields(
			{ name: Label.get(lang, "twitch_live.category"), value: infos.game_name, inline: false },
		);
		if(onlineMode) {
			let ellapsed = Date.now() - new Date(infos.started_at).getTime();
			let uptime:string = Utils.formatDuration(ellapsed);
			if(!this.maxViewersCount[userInfo.id]) this.maxViewersCount[userInfo.id] = 0;
			this.maxViewersCount[userInfo.id] = Math.max(this.maxViewersCount[userInfo.id], infos.viewer_count);
			card.addFields(
				{ name: 'Viewers', value: infos.viewer_count.toString(), inline: true },
				{ name: 'Uptime', value: uptime, inline: true },
			);
			this.lastStreamInfos[userInfo.id] = infos;
		}else{
			author.name = Label.get(lang, "twitch_live.offline", [{id:"user", value:infos.user_name}]);
			card.setAuthor(author);
			let fields:Discord.EmbedField[] = [];
			if(this.maxViewersCount[userInfo.id]) {
				fields.push({ name: Label.get(lang, "twitch_live.viewers_max"), value: this.maxViewersCount[userInfo.id].toString(), inline: true });
			}
			let ellapsed = Date.now() - new Date(infos.started_at).getTime();
			let uptime:string = Utils.formatDuration(ellapsed);
			fields.push({ name: Label.get(lang, "twitch_live.stream_duration"), value: uptime, inline: true });
			card.addFields( fields );
		}
		card.setFooter({text:userInfo.description});
		return card;
	}

	/**
	 * Sends the support form on the current channel
	 */
	private async sendSupportForm(cmd:Discord.CommandInteraction):Promise<void> {
		await cmd.deferReply();
		const lang = this.lang(cmd.guildId as string);
		const support = new Discord.ButtonBuilder({
			label: Label.get(lang, "support.create"),
			style:Discord.ButtonStyle.Danger,
			customId:"support_create"
		})
		const row = new Discord.ActionRowBuilder<Discord.ButtonBuilder>()
		.addComponents([support]);
		let message = cmd.options.get("intro")?.value as string;
		message = message.replace(/\\n|\\r/gi, "\n");//convert \n and \r to actual linebreaks
		if(cmd.channel && cmd.channel.send) {
			await cmd.channel.send({content:message, components:[row]});
		}
		const m = await cmd.fetchReply() as Discord.Message;
		await m.delete();
	}

	/**
	 * Create a support channel
	 */
	private async createSupport(interaction:Discord.ButtonInteraction):Promise<void> {
		interaction.deferReply({ephemeral:true});
		const lang = this.lang(interaction.guildId as string);
		const chanTarget = StorageController.getData(interaction.guildId as string, StorageController.SUPPORT_TARGET) as string;
		const chanName = Label.get(lang, "support.channel_name", [{id:"user", value:interaction.member?.user.username as string}]);
		const chan = await interaction.guild?.channels.create({
			name:chanName,
			type: Discord.ChannelType.GuildText,
			parent:chanTarget,
			permissionOverwrites: [{
				id: interaction.guildId as string,
				allow: [Discord.PermissionsBitField.Flags.Administrator],
				deny: [Discord.PermissionsBitField.Flags.ViewChannel],
			}]
		});
		if(chan && interaction.member) {
			await chan.permissionOverwrites.create(interaction.member.user.id, {ViewChannel:true});
			interaction.editReply(Label.get(lang, "support.creation_success", [{id:"target", value:chan.id}]));
		}
	}

	/**
	 * Sends the roles selector on the current channel
	 */
	private async sendRolesSelector(cmd:Discord.CommandInteraction):Promise<void> {
		await cmd.deferReply();
		const lang = this.lang(cmd.guildId as string);
		let message = Label.get(lang, "roles.intro");
		let selectableRoles = cmd.options.data.map(v=> v.role);
		const idsDone:{[key:string]:boolean} = {};
		selectableRoles = selectableRoles.filter(v=> {
			if(!v) return false;
			if(idsDone[v.id]===true) return false;
			idsDone[v.id] = true;
			return true;
		})

		//Create as much messages as necessary depending on the number of roles VS
		//the maximum reaction count allowed by discord
		do {
			let roles = selectableRoles.splice(0, this.MAX_LIST_ITEMS);
			
			let count = -1;
			const rows:Discord.ActionRowBuilder<Discord.ButtonBuilder>[] = [];
			let row:Discord.ActionRowBuilder<Discord.ButtonBuilder>;
			roles.forEach(r => {
				if(r) {
					if((++count)%5 == 0) {
						row = new Discord.ActionRowBuilder<Discord.ButtonBuilder>()
						rows.push(row);
					}
					row.addComponents(
						new Discord.ButtonBuilder()
							.setCustomId('role_selector:'+r.id)
							.setLabel(r.name)
							.setStyle(Discord.ButtonStyle.Primary),
					)
				}
			});

			if(cmd.channel && cmd.channel.send) {
				await cmd.channel.send({content:message, components:rows});
			}

			// if(selectableRoles.length == 0) {
			// 	const deleteBt = new Discord.ButtonBuilder({
			// 		label: Label.get(lang, "roles.del_all"),
			// 		style:Discord.ButtonStyle.Danger,
			// 		customId:"roles_delete_all"
			// 	})
			// 	const row = new Discord.ActionRowBuilder<Discord.ButtonBuilder>()
			// 	.addComponents([deleteBt]);
			// 	if(cmd.channel) {
			// 		await cmd.channel.send({content:Label.get(lang, "roles.del_all_intro"), components:[row]});
			// 	}
			// }
		}while(selectableRoles.length > 0);
		const m = await cmd.fetchReply() as Discord.Message;
		await m.delete();
	}

	/**
	 * Creates a poll
	 */
	private async createPoll(cmd:Discord.CommandInteraction):Promise<void> {
		await cmd.deferReply();
		const lang = this.lang(cmd.guildId as string);
		const options:AnonPollOption[] = [];
		let emojis = Config.DISCORDBOT_REACTION_EMOJIS.split(" ");
		let anonMode:boolean = false;
		let uniqueMode:boolean = false;
		let title:string = "";
		const customEmojis:string[] = [];
		for (let i = 0; i < cmd.options.data.length; i++) {
			const p = cmd.options.data[i];
			if(p.name.indexOf("emote") > -1) {
				customEmojis.push(p.value as string);
			}
		}
		emojis = customEmojis.concat(emojis);

		for (let i = 0; i < cmd.options.data.length; i++) {
			const p = cmd.options.data[i];
			if(p.name.indexOf("emote") > -1) continue;//Already handled previously
			if(p.name=="title") title = p.value as string;
			else if(p.name=="anonvotes") anonMode = p.value as boolean;
			else if(p.name=="unique") uniqueMode = p.value as boolean;
			else options.push({n:p.value as string, e:emojis.splice(0,1)[0], v:[]});
		}
		
		title += "\n"+Label.get(lang, "poll.created_by", [{id:"user", value:cmd.user.id}]);
		if(anonMode) title += "\n"+Label.get(lang, "poll.anonymous");

		let msg = options.map(option => {
			const votes = Label.get(lang, "poll.vote"+(option.v.length >1? "s":""), [{id:"votes", value:option.v.length.toString()}]);
			const count = anonMode? " **"+votes+" :** " : "";
			return option.e + " ➔ "+ count + option.n;
		}).join("\n");

		if(cmd.channel && cmd.channel.send) {
			let discordMessage = await cmd.channel.send(title + "\n" + msg);
			options.forEach(async v => {
				try {
					await discordMessage.react(v.e);
				}catch(error) {
					Logger.error("Failed '"+v+"'");
				}
			});
	
			if(anonMode) {
				let polls:AnonPoll[] = StorageController.getData(cmd.guildId as string, StorageController.ANON_POLLS);
				if(!polls) polls = [];
				polls.push({
					id: discordMessage.id,
					chan: discordMessage.channelId,
					title: title,
					unique: uniqueMode,
					opt:options,
				})
				StorageController.setData(cmd.guildId as string, StorageController.ANON_POLLS, polls);
			}else if(uniqueMode) {
				let polls:UniquePoll[] = StorageController.getData(cmd.guildId as string, StorageController.UNIQUE_POLLS);
				if(!polls) polls = [];
				polls.push({id:discordMessage.id, chan:discordMessage.channelId});
				StorageController.setData(cmd.guildId as string, StorageController.UNIQUE_POLLS, polls);

			}
		}

		const m = await cmd.fetchReply() as Discord.Message;
		await m.delete();
	}

	/**
	 * Updates count on anonymous polls
	 * @param poll 
	 * @param reaction 
	 */
	private async updateAnonPoll(poll:AnonPoll, reaction:Discord.MessageReaction, lang:string):Promise<void> {
		let msg = poll.opt.map(option => {
			const votes = Label.get(lang, "poll.vote"+(option.v.length >1? "s":""), [{id:"votes", value:option.v.length.toString()}]);
			return option.e + " ➔ **"+votes+" :** "+ option.n;
		} ).join("\n");
		await reaction.message.edit(poll.title + "\n" + msg);
	}

	/**
	 * Called when a user sets her/his birthday
	 * 
	 * @param cmd 
	 */
	private async setBirthday(cmd:Discord.CommandInteraction):Promise<void> {
		await cmd.deferReply({ephemeral:true});

		const lang = this.lang(cmd.guildId as string);
		
		let birthdays:BirthdayCollection = StorageController.getData(cmd.guildId as string, StorageController.BIRTHDAYS);
		const date = cmd.options.get("date")?.value as string;
		const chunks = date.split(/[^0-9]+/gi);
		const day = parseInt(chunks[0]);
		const month = parseInt(chunks[1]);
		if(isNaN(day) || day<1 || day > 31
		|| isNaN(month) || month<1 || month > 12) {
			const format = Label.get(lang, "commands.birthday.option")
			cmd.editReply(Label.get(lang, "birthday.invalid_date", [{id:"format", value:format}]));
			return;
		}

		if(!birthdays) birthdays = {};
		birthdays[cmd.user.id] = {day, month};

		function toDigits(n:number):string {
			if(n < 10) return "0"+n;
			return n.toString();
		}
		StorageController.setData(cmd.guildId as string, StorageController.BIRTHDAYS, birthdays);
		cmd.editReply( Label.get(lang, "birthday.success", [{id:"date", value:toDigits(day)+"/"+toDigits(month)}]));
	}

	/**
	 * Called when configuring the inactivity timeout
	 * 
	 * @param cmd 
	 */
	private async saveInactivityParams(cmd:Discord.CommandInteraction):Promise<void> {
		const lang = this.lang(cmd.guildId as string);

		cmd.deferReply({ephemeral:true});
		if(cmd.options.get("disable")?.value === true) {
			StorageController.delData(cmd.guildId as string, StorageController.INACTIVITY_CONFIGS);
			cmd.editReply(Label.get(lang, "commands.admin.inactivity.disable_ok"));
			return;
		}


		const days = cmd.options.get("days")?.value as number;
		const daysWarn = cmd.options.get("days_warn")?.value as number;
		const rolesAdd:string[] = [];
		const rolesDel:string[] = [];

		for (let i = 1; i < 10; i++) {
			const p = cmd.options.get("role_add_"+i);
			if(!p || !p.role) break;
			rolesAdd.push(p.role.id);
		}

		for (let i = 1; i < 10; i++) {
			const p = cmd.options.get("role_del_"+i);
			if(!p || !p.role) break;
			rolesDel.push(p.role.id);
		}

		const configs:InactivityConfig = {
			days,
			daysWarn,
			rolesAdd,
			rolesDel,
		}

		StorageController.setData(cmd.guildId as string, StorageController.INACTIVITY_CONFIGS, configs);
	}
}

interface BirthdayCollection {
	[key:string]:Birthday
}

interface Birthday {
	day:number;
	month:number;
	lastAlert?:number;
}

interface InactivityConfig {
	days:number;
	daysWarn:number;
	rolesAdd:string[];
	rolesDel:string[];
}