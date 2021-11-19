<img src="https://user-images.githubusercontent.com/721001/142517726-b549a5f4-8fda-44ed-b640-df97d576ef44.png" height="200">

# SLipLord
Simple Discord bot that alerts when you go live on Twitch and that shows up a roles selector, so the members can add roles to their profiles by themselves without opening roles management to everyone.\
\
*⚠️ : All discord messages are hardcoded in French for now*
<br />
<br />
<br />

# Table of content
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
	"DISCORDBOT_ROLES_EMOJIS":"❤️ 🧡 💛 💚 💙 💜 🤎 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔴 🟠 🟡 🟢 🔵 🟣 🟤"
}
```

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
By default the bot will associate every **`mentionable`** roles to one of these emojis :
```
❤️ 🧡 💛 💚 💙 💜 🤎 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔴 🟠 🟡 🟢 🔵 🟣 🟤
```
If you have more than 21 `mentionable` roles on your discord you will want to add emojis to this list on the **DISCORDBOT_ROLES_EMOJIS** field of the `configs.json` file. All emojis must be separated by a space.
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
pm2 logs --raw ProtopotesRaider
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
