<img src="https://user-images.githubusercontent.com/721001/142517726-b549a5f4-8fda-44ed-b640-df97d576ef44.png" height="200">

# SlipLord
Simple Discord bot that alerts when you go live on Twitch and that shows up a roles selector, so the members can add roles to their profiles by themselves without opening roles management to everyone.\
\
*⚠️ : All discord messages are hardcoded in French for now*\
\
Here is an example of what the bot sends when you go live and when you enable the roles manager:\
<br />
![image](https://user-images.githubusercontent.com/721001/142634244-cbce6d70-4fde-409f-81b1-febf684f3376.png)

<br />
<br />
<br />

# Table of content
* [Available Features](#features) 
  * [Live alerts](#live-alerts)
  * [Roles selector](#roles-selector)
  * [Poll shortcut](#poll-shortcut)
* [Project setup and config](#project-setup-and-config) 
* [Add bot to discord's channels](#add-bot-to-discords-channels) 
* [Roles reactions configuration](#roles-reactions) 
* [Project dev/build](#project-devbuild) 
  * [Start all for developpement](#start-all-for-developpement)
  * [Compile all for production](#compile-all-for-production)
* [Starting Services](#starting-services) 
* [Start on boot](#start-on-boot) 
<br />
<br />
<br />

# Available Features
The `{prefix}` value on the examples is the `BOT_NAME` configured on `configs.json`. *(See [Project setup and config](#project-setup-and-config))*

## Live alerts
Warn your users when you go live on Twitch.\
To enable this feature use the following command on the channel you want to send alerts to :\
```
!{prefix}-live
```
![image](https://user-images.githubusercontent.com/721001/148676359-e89ed253-4034-4be0-90c7-4143892802c1.png)

## Roles selector
Allow your members to self attribute roles by adding reaction to a message.\
To enable this feature use the following command on the channel you want to send role selector to :\
```
!{prefix}-roles
```
![image](https://user-images.githubusercontent.com/721001/148676376-d458a7f9-b3cf-40b4-a52c-90970cf31015.png)

## Poll shortcut
Quickly create a poll message with pre-selected corresponding reactions to avoid having doing it mannually.
Example :
```
!{prefix}-poll This is a poll example
Vote for this !
No, Vote for this !
Well, actually, you should vote for this.
...
Last poll option
```
The first line will be the poll's title.
Add one line per voting option bellow.
This will automatically attribute an emote to every voting option and add corresponding reactions to the message.\
![image](https://user-images.githubusercontent.com/721001/148676525-9af021e1-d9df-4b31-8314-39d9d1ce208b.png)

<br />
<br />
<br />

# Project setup and config
Install all the dependencies with this command:
```
npm install
```

Create a `configs.json` file at the root of the project and add this content :\
```json
{
	"BOT_NAME":"SlipLord",

	"TWITCH_LOGIN":"",
	"TWITCH_USER_ID":"",

	"TWITCH_EVENTSUB_SECRET":"",
	"PUBLIC_SECURED_URL": "https://...",

	"TWITCH_APP_CLIENT_ID":"",
	"TWITCH_APP_CLIENT_SECRET":"",
	"TWITCH_APP_SCOPES":"",

	"DISCORDBOT_TOKEN":"",
	"DISCORDBOT_ROLES_EMOJIS":"\u0030\u20E3 \u0031\u20E3 \u0032\u20E3 \u0033\u20E3 \u0034\u20E3 \u0035\u20E3 \u0036\u20E3 \u0037\u20E3 \u0038\u20E3 \u0039\u20E3 \ud83c\udde6 \ud83c\udde7 \ud83c\udde8 \ud83c\udde9 \ud83c\uddea \ud83c\uddeb \ud83c\uddec \ud83c\udded \ud83c\uddee \ud83c\uddef \ud83c\uddf0 \ud83c\uddf1 \ud83c\uddf2 \ud83c\uddf3 \ud83c\uddf4 \ud83c\uddf5 \ud83c\uddf6 \ud83c\uddf7 \ud83c\uddf8 \ud83c\uddf9 \ud83c\uddfa \ud83c\uddfb \ud83c\uddfc \ud83c\uddfd \ud83c\uddfe \ud83c\uddff ❤️ 🧡 💛 💚 💙 💜 🤎 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔴 🟠 🟡 🟢 🔵 🟣 🟤"
}
```
*(The emojis are number 0-9, then letters a-z, then hearts, squares and disks. You can change them but please about colorblind people !)*

Set the name of your bot on the **BOT_NAME** field. The lowercased version of this value will be the prefix for all bot's commands.\
\
Create a twitch app [here](https://dev.twitch.tv/console/apps), and fill the **TWITCH_APP_CLIENT_ID** and **TWITCH_APP_CLIENT_SECRET** values.\
\
You can leave the **TWITCH_APP_SCOPES** empty.\
\
Write anything you want on the **TWITCH_EVENTSUB_SECRET**. Must be between 10 and 100 chars.\
\
**PUBLIC_SECURED_URL** is the public HTTPS URL of your server that will receive EventSub notifications from twitch. If working locally you can use NGrok to create a secured tunnel to your local.\
\
Set your twitch login on **TWITCH_LOGIN** field.\
\
Set your twitch user ID on **TWITCH_USER_ID** field.\
\
Set your twitch login on **TWITCH_LOGIN** field.\
\
Create a discord app and bot [here](https://discord.com/developers/applications), and fill the **DISCORDBOT_TOKEN** with the bot's tokken.
<br />
<br />
<br />

# Add bot to discord's channels
Use this command on a discord channel to configure alerts :
```
!sliplord-live
```
Use this command on a discord channel to configure roles selector :
```
!sliplord-roles
```
Use this command to get a list of the available commands :
```
!sliplord-help
```
⚠️ : the `sliplord` prefix might different depending on what you set as the **BOT_NAME** in the `configs.json` file.
<br />
<br />
<br />

# Roles reactions
The bot will associate every **`mentionable`** roles to one of the emojis specified on the `configs.json`.\
<span style="text-decoration: underline">**IMPORTANT**</span>: make sure the `mentionable` option is enabled on the roles that have to be selectable ! Go to you server params -> `roles` -> click a role and check the *"`Allow everyone to @mention this role`"* option.

If you want to customize the emojis used to select a role, update the list on `configs.json` file. See `DISCORDBOT_ROLES_EMOJIS` property. All emojis must be separated by a space.
<br />
<br />
<br />

# Project dev/build

## Start all for developpement
```
npm run dev
``` 
Starts front and server with hot reload.\
Node process has to be started manually. See [Starting services section](#starting-services).

## Compile all for production
```
npm run build
``` 
<br />
<br />
<br />

# Starting services
Execute this inside project folder's root
```
pm2 start bootstrap-pm2.json
```

To view process logs via PM2, execute :
```
pm2 logs --raw SlipLord
```
<br />
<br />
<br />

# Start on boot
**DOESN'T work on windows**\
First start the client as explained above.  
Then execute these commands:
```
pm2 save
pm2 startup
```
Now, the service should automatically start on boot 
