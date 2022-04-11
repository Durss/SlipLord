import { SlashCommandBuilder } from "@discordjs/builders";
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";
import * as Discord from "discord.js";
import { ApplicationCommandPermissionTypes } from "discord.js/typings/enums";
import { Express } from "express-serve-static-core";
import Config from "../utils/Config";
import { Event, EventDispatcher } from "../utils/EventDispatcher";
import Label from "../utils/Label";
import Logger from '../utils/Logger';
import TwitchUtils, { TwitchTypes } from "../utils/TwitchUtils";
import Utils from "../utils/Utils";
import { AnonPoll, AnonPollOption, StorageController, TwitchLiveMessage, TwitchUser } from "./StorageController";

/**
* Created : 15/10/2020 
*/
export default class DiscordController extends EventDispatcher {

	private client:Discord.Client;
	private maxViewersCount:{[key:string]:number} = {};
	private lastStreamInfos:{[key:string]:TwitchTypes.StreamInfo} = {};
	private refreshTimeouts:{[key:string]:any} = {};

	private MAX_LIST_ITEMS:number = 25;//maximum reactions per message allowed by discord
	
	
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
			Discord.Intents.FLAGS.GUILDS,
			Discord.Intents.FLAGS.GUILD_MEMBERS,
			Discord.Intents.FLAGS.GUILD_MESSAGES,
			Discord.Intents.FLAGS.DIRECT_MESSAGES,
			Discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
			Discord.Intents.FLAGS.DIRECT_MESSAGE_REACTIONS,
		] });

		//Called when API is ready
		this.client.on("ready", ()=> this.onReady());
		this.client.on("messageCreate", (message) => this.onMessage(message));
		//Called when using a /command
		this.client.on("interactionCreate", (interaction) => this.onCommand(interaction))
		//Called when a reaction is added to a message
		this.client.on("messageReactionAdd", (reaction) => this.onAddReaction(reaction as Discord.MessageReaction));
		//Called when a reaction is removed from a message
		this.client.on("messageReactionRemove", (reaction) => this.onRemoveReaction(reaction as Discord.MessageReaction));
		//Called when a new member joins the server
		this.client.on("guildMemberAdd", (member) => this.onAddMember(member))
		//Called when bot is added to a new discord
		this.client.on("guildCreate", (guild) => this.createCommands(guild) );
		//Called when bot is kicked out a discord
		this.client.on("guildDelete", (guild) => StorageController.deleteStore(guild.id) );

		try {
			await this.client.login(Config.DISCORDBOT_TOKEN);
		}catch(error) {
			Logger.error("Invalid discord token !");
			console.log(error);
		}
		this.createCommands();
		this.listenForReactions();
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
			let userInfos = await TwitchUtils.loadChannelsInfo(null, [uid]);
			let userInfo = userInfos[0];
			for (let i = 0; i < users.length; i++) {
				const user = users[i];
				if(user.uid != uid) continue;

				let editedMessage :Discord.Message;
				const channel = this.client.channels.cache.get(user.channel) as Discord.TextChannel;
				const historyKey = user.uid +"_"+user.channel+"_"+guild.id;
				
				let usersStorage:{[key:string]:TwitchLiveMessage} = StorageController.getData("global", StorageController.TWITCH_USERS);
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
							StorageController.saveData("global", StorageController.TWITCH_USERS, usersStorage);
						}else{
							//Send new message
							message = await channel.send({embeds:[card]});

							//Add a new live entry for this user on the global storage
							usersStorage[historyKey] = {
								date:Date.now(),
								messageId:message.id,
							};
							StorageController.saveData("global", StorageController.TWITCH_USERS, usersStorage);
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
	 * Creates the bot's commands and add them to all the guilds
	 */
	private async createCommands(guild?:Discord.Guild):Promise<void> {
		const rest = new REST({ version: '9' }).setToken(Config.DISCORDBOT_TOKEN);
		const langChoices = [];
		const locales = Label.getLocales();
		for (let i = 0; i < locales.length; i++) {
			const l = locales[i];
			langChoices.push([l.name, l.id]);
		}
		
		const roles = new SlashCommandBuilder()
			.setDefaultPermission(false)
			.setName(Config.CMD_PREFIX+'roles_selector')
			.setDescription('Adds a role selector with the specified roles or all if no roles are specified')
			.addRoleOption(option => option.setName('role1').setDescription('role N°1'))
			.addRoleOption(option => option.setName('role2').setDescription('role N°2'))
			.addRoleOption(option => option.setName('role3').setDescription('role N°3'))
			.addRoleOption(option => option.setName('role4').setDescription('role N°4'))
			.addRoleOption(option => option.setName('role5').setDescription('role N°5'))
			.addRoleOption(option => option.setName('role6').setDescription('role N°6'))
			.addRoleOption(option => option.setName('role7').setDescription('role N°7'))
			.addRoleOption(option => option.setName('role8').setDescription('role N°8'))
			.addRoleOption(option => option.setName('role9').setDescription('role N°9'))
			.addRoleOption(option => option.setName('role10').setDescription('role N°10'))
			.addRoleOption(option => option.setName('role11').setDescription('role N°11'))
			.addRoleOption(option => option.setName('role12').setDescription('role N°12'))
			.addRoleOption(option => option.setName('role13').setDescription('role N°13'))
			.addRoleOption(option => option.setName('role14').setDescription('role N°14'))
			.addRoleOption(option => option.setName('role15').setDescription('role N°15'))
			.addRoleOption(option => option.setName('role16').setDescription('role N°16'))
			.addRoleOption(option => option.setName('role17').setDescription('role N°17'))
			.addRoleOption(option => option.setName('role18').setDescription('role N°18'))
			.addRoleOption(option => option.setName('role19').setDescription('role N°19'))
			.addRoleOption(option => option.setName('role20').setDescription('role N°20'));
		
		const admin = new SlashCommandBuilder()
		
			.setDefaultPermission(false)
			.setName(Config.CMD_PREFIX+'admin')
			.setDescription('admin a protobud feature')
			.addSubcommand(subcommand =>
				subcommand
					.setName('access')
					.setDescription('Allows or disallows the specified role or user to use the private commands')
					.addRoleOption(option => option.setName('allow_role').setDescription('Role to allow'))
					.addRoleOption(option => option.setName('disallow_role').setDescription('Role to allow'))
					.addUserOption(option => option.setName('allow_user').setDescription('User to allow'))
					.addUserOption(option => option.setName('disallow_user').setDescription('User to allow'))
			)
			.addSubcommand(subcommand =>
				subcommand
					.setName('language')
					.setDescription('Change the bot\'s language')
					.addStringOption(option => option.setRequired(true).setName('lang').setDescription('Language to use').addChoices(langChoices))
			);

		const twitch = new SlashCommandBuilder()
			.setDefaultPermission(false)
			.setName(Config.CMD_PREFIX+'twitch')
			.setDescription('Enable or disable twitch live notifications')
			.addStringOption(option => option.setRequired(false).setName('watch_login').setDescription('The twitch login of the channel to start watching'))
			.addStringOption(option => option.setRequired(false).setName('unwatch_login').setDescription('The twitch login of the channel to stop watching'))
		
		const poll = new SlashCommandBuilder()
			.setName(Config.CMD_PREFIX+'poll')
			.setDescription('Create a poll')
			.addStringOption(option => option.setRequired(true).setName('title').setDescription('Title of the poll'))
			.addStringOption(option => option.setRequired(true).setName('option1').setDescription('Name of the first option'))
			.addStringOption(option => option.setRequired(true).setName('option2').setDescription('Name of the second option'))
			.addBooleanOption(option => option.setName('anonvotes').setDescription('Should votes be anonnymous?'))
			.addBooleanOption(option => option.setName('unique').setDescription('Can user vote for only one option? (only works if anonvotes is true)'))
			.addStringOption(option => option.setName('option3').setDescription('Name of the third option'))
			.addStringOption(option => option.setName('option4').setDescription('Name of the option 4'))
			.addStringOption(option => option.setName('option5').setDescription('Name of the option 5'))
			.addStringOption(option => option.setName('option6').setDescription('Name of the option 6'))
			.addStringOption(option => option.setName('option7').setDescription('Name of the option 7'))
			.addStringOption(option => option.setName('option8').setDescription('Name of the option 8'))
			.addStringOption(option => option.setName('option9').setDescription('Name of the option 9'))
			.addStringOption(option => option.setName('option10').setDescription('Name of the option 10'))
			.addStringOption(option => option.setName('option11').setDescription('Name of the option 11'))
			.addStringOption(option => option.setName('option12').setDescription('Name of the option 12'))
			.addStringOption(option => option.setName('option13').setDescription('Name of the option 13'))
			.addStringOption(option => option.setName('option14').setDescription('Name of the option 14'))
			.addStringOption(option => option.setName('option15').setDescription('Name of the option 15'))
			.addStringOption(option => option.setName('option16').setDescription('Name of the option 16'))
			.addStringOption(option => option.setName('option17').setDescription('Name of the option 17'))
			.addStringOption(option => option.setName('option18').setDescription('Name of the option 18'))
			.addStringOption(option => option.setName('option19').setDescription('Name of the option 19'))
			.addStringOption(option => option.setName('option20').setDescription('Name of the option 20'))

		//Add commands to all guilds the bot has been added to
		const guilds = this.client.guilds.cache.entries();
		do {
			//Add commands to current guild
			const guildLocal = guilds.next();
			if(guildLocal.done) break;

			//If adding command to one specific discord, ignore the others
			if(guild && guild.id != guildLocal.value[0]) continue;

			await rest.put(
				Routes.applicationGuildCommands(Config.DISCORDBOT_CLIENT_ID, guildLocal.value[0]),
				{ body: [poll.toJSON(), admin.toJSON(), roles.toJSON(), twitch.toJSON()] },
			);
			
			//Allow admins to use all commands
			const guildItem:Discord.Guild = guildLocal.value[1];
			let members = await guildItem.members.fetch();
			let commands = (await guildItem.commands.fetch()).toJSON();
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
		}while(true);
		Logger.success("Commands added to all guilds");
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
			const polls:AnonPoll[] = StorageController.getData(guild.id, StorageController.ANON_POLLS);
			if(polls) {
				for (let i = 0; i < polls.length; i++) {
					const poll = polls[i];
					const chan = await guild.channels.cache.get(poll.chan).fetch() as Discord.TextChannel;
					try {
						//Simply load the message in cache to receive the reactions updates
						await chan.messages.fetch(poll.id);
					}catch(err) {
						//Cleanup the poll from storage
						polls.splice(i,1);
						i--;
					}
				}
				StorageController.saveData(guild.id, StorageController.ANON_POLLS, polls);
			}
		}
		Logger.success("Anon polls listened successfully");
	}

	/**
	 * Called when a command is executed
	 * 
	 * @param interaction 
	 * @returns 
	 */
	private async onCommand(interaction:Discord.Interaction):Promise<void> {
		let lang = this.lang(interaction.guildId);
		let user = await interaction.guild.members.fetch(interaction.user.id);
		if(interaction.isButton()) {
			switch(interaction.customId){
				case "roles_delete_all": {
					interaction.deferReply();
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
								await user.roles.remove( role.id );
							}catch(error) {
								Logger.error("Failed removing", role.name)
							}
						}
					}

					//If no role has been deleted we need to wait a little
					//before replying to after a deferReply() or Discord
					if(!roleDeleted) await Utils.promisedTimeout(1000);
					const m = await interaction.editReply(Label.get(lang, "roles.del_all_ok", [{id:"user", value:user.id}]));
					await Utils.promisedTimeout(10000);
					if(m.type == "REPLY") await m.delete();
					break;
				}
			}
		}

		//If it's a menu selection
		if(interaction.isSelectMenu()) {
			const cmd = interaction as Discord.SelectMenuInteraction;
			let action = cmd.customId;
			switch(action) {
				case "role_selector":{
					interaction.deferUpdate();
					for (let i = 0; i < cmd.values.length; i++) {
						await user.roles.add( cmd.values[i] );
					}
					
					//Reset selection
					await interaction.editReply({ content: Label.get(lang, "roles.intro") });

					//Confirm roles update
					const answer = await interaction.channel.send(Label.get(lang, "roles.add_ok", [{id:"user", value:user.id}]));
					setTimeout(async _=> {
						//Delete confirmation
						try {
							await answer.delete();
						}catch(error) {};
					}, 10000);
					break;
				}
			}
		}

		//If it's a command execution
		if(interaction.isCommand()) {
			const cmd = interaction as Discord.CommandInteraction;
			let action = cmd.commandName;
			try {
				const subCommand = cmd.options.getSubcommand();
				if(subCommand) action += "/" + subCommand;
			}catch(error) {}
			
			action = action.replace(new RegExp("^"+Config.CMD_PREFIX, "i"), "");
	
			switch(action) {
				case "admin/access": {
					this.setAccessTo(cmd);
					break;
				}
				
				case "admin/language": {
					await cmd.deferReply({ephemeral:true});
					lang = cmd.options.get("lang").value as string;
					StorageController.saveData(cmd.guildId, StorageController.LANGUAGE, lang);
					cmd.editReply(Label.get(lang, "admin.language_updated"));
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
			}
		}
	}

	/**
	 * Start watching for a twitch user to go live
	 */
	private async twitchLiveAlertChannel(cmd:Discord.CommandInteraction):Promise<void> {
		let watch:boolean = false;
		let key = "unwatch_login";
		if(cmd.options.get("watch_login")) {
			watch = true;
			key = "watch_login";
		}
		const lang = this.lang(cmd.guildId);
		if(!Config.IS_TWITCH_CONFIGURED) {
			cmd.reply({content:Label.get(lang, "twitch.not_configured"), ephemeral:true});
			return;
		}
		const user = cmd.options.get(key).value as string;
		const userRes = await TwitchUtils.loadChannelsInfo([user]);
		if(userRes.length>0) {
			const user = userRes[0];
			let list = StorageController.getData(cmd.guildId, StorageController.TWITCH_USERS);
			if(!list) list = [];
			if(watch) {
				if(list.findIndex(v=>v.uid==user.id && v.channel==cmd.channelId) == -1) {
					list.push({uid:user.id, login:user.login, channel:cmd.channelId});
				}
			}else{
				const index = list.findIndex(v=>v.uid==user.id);
				if(index > -1) list.splice(index, 1);
			}
			StorageController.saveData(cmd.guildId, StorageController.TWITCH_USERS, list);
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
		let anonPolls = StorageController.getData(reaction.message.guildId, StorageController.ANON_POLLS) as AnonPoll[];
		if(anonPolls){
			//Check if react to an anon poll and update it if so
			for (let i = 0; i < anonPolls.length; i++) {
				const p = anonPolls[i];
				if(p.id === reaction.message.id) {
					//Found an anon poll matching the reaction source
					const users = reaction.users.cache.entries();
					while(true){
						const user = users.next();
						let update = false;
						if(user.done) break;
						if(user.value[0] === reaction.message.author.id) continue;
						p.opt.forEach(o=> {
							if(o.e === reaction.emoji.name) {
								if(o.v.indexOf(user.value[0]) == -1) {
									o.v.push(user.value[0]);
									update = true;
								}
							}else if(p.unique === true && o.v.indexOf(user.value[0]) > -1) {
								const index = o.v.indexOf(user.value[0]);
								o.v.splice(index, 1);
								update = true;
							}
						});
						if(update) {
							this.updateAnonPoll(p, reaction);
						}
						reaction.users.remove(user.value[0]);
					}
				}
			}
			StorageController.saveData(reaction.message.guildId, StorageController.ANON_POLLS, anonPolls);
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
		let	cmd = chunks.shift().toLowerCase();
		// let prefix = Config.BOT_NAME.toLowerCase();
		
		// if(cmd.indexOf(prefix) != 0) return;
		// cmd = cmd.replace(prefix+"-", "");

		if(isAdmin) {
			if(cmd == "test-live") {
				const userInfos = await TwitchUtils.loadChannelsInfo([chunks[0]]);
				if(userInfos.length == 0) {
					message.reply("Twitch user not found")
					return;
				}

				const user = userInfos[0];
				const streamInfos = await TwitchUtils.getStreamsInfos(null, [user.id]);
				if(streamInfos.length == 0) {
					message.reply("Twitch user is not live")
					return;
				}
				
				const streamDetails = streamInfos[0];
				let card = this.buildLiveCard(message.guildId, streamDetails, user, true);
				await message.channel.send({embeds:[card]});
			}
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
	private buildLiveCard(guildId:string, infos:TwitchTypes.StreamInfo, userInfo:TwitchTypes.UserInfo, onlineMode:boolean = true):Discord.MessageEmbed {
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

		let card = new Discord.MessageEmbed();
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
	 * Gives/remove access to private commandes to a user or a role
	 */
	private async setAccessTo(cmd:Discord.CommandInteraction):Promise<void> {
		await cmd.deferReply();
		let commands = (await cmd.guild.commands.fetch()).toJSON();
		const lang = this.lang(cmd.guildId);

		//Define update parameters
		let id:string, allow:boolean, type:ApplicationCommandPermissionTypes;
		if(cmd.options.get("allow_role")){
			id = cmd.options.get("allow_role").role.id;
			allow = true;
			type = ApplicationCommandPermissionTypes.ROLE;
		}else if(cmd.options.get("disallow_role")){
			id = cmd.options.get("disallow_role").role.id;
			allow = false;
			type = ApplicationCommandPermissionTypes.ROLE;
		}else if(cmd.options.get("allow_user")){
			id = cmd.options.get("allow_user").user.id;
			allow = true;
			type = ApplicationCommandPermissionTypes.USER;
		}else if(cmd.options.get("disallow_user")){
			id = cmd.options.get("disallow_user").user.id;
			allow = false;
			type = ApplicationCommandPermissionTypes.USER;
		}

		//Update commands
		for (let i = 0; i < commands.length; i++) {
			const command = commands[i];
			if(command.defaultPermission) continue;//If it's a public command, no need to add permissions
			const permissions = [ { id, type, permission: allow, }, ];
			await command.permissions.add({ permissions });
		}

		//Confirm update
		let message:string ="";
		if(type == ApplicationCommandPermissionTypes.ROLE){
			message = Label.get(lang, "admin.role_" + (allow?"allowed":"disallowed"), [{id:"role", value:id}]);
		}else{
			message = Label.get(lang, "admin.user_" + (allow?"allowed":"disallowed"), [{id:"user", value:id}]);
		}
		cmd.channel.send(message)
		Logger.success(message);
		const m = await cmd.fetchReply() as Discord.Message;
		await m.delete();
	}

	/**
	 * Sends the roles selector on the specified channel
	 */
	private async sendRolesSelector(cmd:Discord.CommandInteraction):Promise<void> {
		await cmd.deferReply();
		const lang = this.lang(cmd.guildId);
		let message = Label.get(lang, "roles.intro");
		const selectableRoles = cmd.options.data.map(v=> v.role);

		//Create as much messages as necessary depending on the number of roles VS
		//the maximum reaction count allowed by discord
		do {
			let roles = selectableRoles.splice(0, this.MAX_LIST_ITEMS);
			const listItems = [];
			roles.forEach(r => {
				listItems.push(
					{
						label: r.name,
						value: r.id,
					}
				)
			});

			const list = new Discord.MessageSelectMenu()
				.setCustomId('role_selector')
				.setPlaceholder(Label.get(lang, "roles.list_placeholder"))
				.setMinValues(1)
				.setMaxValues(listItems.length)
				.addOptions(listItems);
			const row = new Discord.MessageActionRow()
			.addComponents([list]);

			await cmd.channel.send({content:message, components:[row]});

			if(selectableRoles.length == 0) {
				const deleteBt = new Discord.MessageButton({
					label: Label.get(lang, "roles.del_all"),
					style:"DANGER",
					customId:"roles_delete_all"
				})
				const row = new Discord.MessageActionRow()
				.addComponents([deleteBt]);
				await cmd.channel.send({content:Label.get(lang, "roles.del_all_intro"), components:[row]});
			}
		}while(selectableRoles.length > 0);
		const m = await cmd.fetchReply() as Discord.Message;
		await m.delete();
	}

	/**
	 * Creates a poll
	 */
	private async createPoll(cmd:Discord.CommandInteraction):Promise<void> {
		await cmd.deferReply();
		const lang = this.lang(cmd.guildId);
		const options:AnonPollOption[] = [];
		const emojis = Config.DISCORDBOT_REACTION_EMOJIS.split(" ")
		let anonMode:boolean = false;
		let uniqueMode:boolean = false;
		let title:string;
		for (let i = 0; i < cmd.options.data.length; i++) {
			const p = cmd.options.data[i];
			if(p.name=="title") title = p.value as string;
			else if(p.name=="anonvotes") anonMode = p.value as boolean;
			else if(p.name=="unique") uniqueMode = p.value as boolean;
			else options.push({n:p.value as string, e:emojis.splice(0,1)[0], v:[]});
		}
		
		title += "\n"+Label.get(lang, "poll.created_by", [{id:"user", value:cmd.user.id}]);

		let msg = options.map(option => {
			const count = anonMode? " `(x"+option.v.length+"`)" : "";
			return option.e + count + " ➔ "+ option.n;
		}).join("\n");

		let discordMessage = await cmd.channel.send(title + "\n" + msg);
		options.forEach(async v => {
			try {
				await discordMessage.react(v.e);
			}catch(error) {
				console.log("Failed '"+v+"'");
			}
		});

		if(anonMode) {
			let polls:AnonPoll[] = StorageController.getData(cmd.guildId, StorageController.ANON_POLLS);
			if(!polls) polls = [];
			polls.push({
				id: discordMessage.id,
				chan: discordMessage.channelId,
				title: title,
				unique: uniqueMode,
				opt:options,
			})
			StorageController.saveData(cmd.guildId, StorageController.ANON_POLLS, polls);
		}

		const m = await cmd.fetchReply() as Discord.Message;
		await m.delete();
	}

	private async updateAnonPoll(poll:AnonPoll, reaction:Discord.MessageReaction):Promise<void> {
		let msg = poll.opt.map(option => option.e + " `(x"+option.v.length+")` ➔ "+ option.n ).join("\n");
		await reaction.message.edit(poll.title + "\n" + msg);
	}

	/**
	 * Gets the locale configured for the specified guild
	 */
	private lang(guildId:string):string {
		const lang = StorageController.getData(guildId, StorageController.LANGUAGE);
		if(!lang) return Label.getLocales()[0].id;
		return lang;
	}
}