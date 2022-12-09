<div align="center"><img src="https://user-images.githubusercontent.com/721001/142517726-b549a5f4-8fda-44ed-b640-df97d576ef44.png" height="200"></div>

# SlipLord
A Discord bot that can alert when someone goes **live on Twitch**, allow members to self-attribute a **restricted roles list**, create (anonymous) **polls**, offer a **support system** that automatically creates private chans, and adds the possibility for your members to set their **birthdate** so alerts are posted on a chan when it's their birtday.\
\
It can be installed on multiple discord servers.
<br />
<br />
<br />

# Table of content
* [Install bot](#install-bot) 
* [Available Features](#features) 
  * [Change language](#change-language)
  * [Live alerts](#live-alerts)
  * [Roles selector](#roles-selector)
  * [Create a poll](#create-a-poll)
  * [Birthday alerts](#birthday-alerts)
  * [Support system](#support-system)
* [Project setup and config](#project-setup-and-config) 
* [Project dev/build](#project-devbuild) 
  * [Start all for developpement](#start-all-for-developpement)
  * [Compile all for production](#compile-all-for-production)
* [Starting Services](#starting-services) 
* [Start on boot](#start-on-boot) 
<br />
<br />
<br />

# Install bot 
Please first read the [Project setup and config](#project-setup-and-config) section.\
The easiest is to invite your bot with the administrator permissions.\
\
Use this URL to add it to your discord with such permissions:\
*(replace the [BOT CLIENT ID] placeholder by the actual bot's client ID)*
```
https://discord.com/api/oauth2/authorize?client_id=[BOT CLIENT ID]&permissions=8&scope=bot%20applications.commands
```
The bot won't automatically install slash commands after joining your server.\
You can choose which feature to install by sending this command on a private chan *(don't forget to give read/write access to the bot)*:
```
!BOT_NAME-install
```
`BOT_NAME` being the value specified on `config.json` file *(see [Project setup and config](#project-setup-and-config))*.
<br />
<br />
<br />

# Available Features

## Change language
As of today the bot supports 2 languages, english and french.\
The default language is english but you can change it by using this slash command:
```
/admin language lang:XX
```
The available languages will be autocompleted on the `lang` argument.
If you want to change some labels or add support for a new language, head over the `labels.json` file.

## Live alerts
Warn your users when you go live on Twitch.\
To enable this feature use the following slash command on the channel you want to send alerts to :
```
/twitch watch_login:[TWITCH USER]
```
![image](https://user-images.githubusercontent.com/721001/148676359-e89ed253-4034-4be0-90c7-4143892802c1.png)

## Roles selector
Allow your members to self attribute roles by selecting them on a dropdown list.\
To post the role selector use this slash command:
```
/roles_selector role1:xxx role2:xxx role3:xxx roleN:xxx
```

## Create a poll
Quickly create a poll message with pre-selected corresponding reactions to avoid having doing it mannually.\
Example :
```
/poll title:XXX option1:XXX option2:XXX optionN:XXX
```
This will automatically attribute an emote to every voting option and add corresponding reactions to the message.\
![image](https://user-images.githubusercontent.com/721001/148676525-9af021e1-d9df-4b31-8314-39d9d1ce208b.png)

You can also create an anonymous poll that will keep track of the votes but make reactions anonymous.

## Birthday alerts
Allow your members to specify their birthdate and get alerts posted on a chan when it's someone's birthday.\
Use this slash command on a chan to configure the alerts target:
```
/admin birthday_target 
```
The members can then set their birthdates with this slash command:
```
/birthday date:[DD-MM]
```

## Support system
Allow your members to contact the administrators with the click of a button that will automatically create a private channel on a custom category.\
Only that user and the admins will have access to that chan.
Use this slash command on a chan to send the support button:
```
/support form intro:[message displayed before the button to give some context]
```
Also use this command to specify the category in which create the private support channels
```
/support target category:XXX
```
<br />
<br />
<br />

# Project setup and config
Install all the dependencies with this command:
```
npm install
```

Create a `configs.json` file at the root of the project and add this content :
```json
{
	"SERVER_PORT":3023,
	"BOT_NAME":"SlipLord",
	"CMD_PREFIX":"",
	"TIMEZONE_OFFSET":2,

	"PUBLIC_SECURED_URL": "",

	"TWITCH_LOGIN":"",
	"TWITCH_USER_ID":"",

	"TWITCH_EVENTSUB_SECRET":"",
	"TWITCH_APP_CLIENT_ID":"",
	"TWITCH_APP_CLIENT_SECRET":"",
	"TWITCH_APP_SCOPES":"",

	"DISCORDBOT_CLIENT_ID":"",
	"DISCORDBOT_TOKEN":"",

	"DISCORDBOT_REACTION_EMOJIS":"\u0030\u20E3 \u0031\u20E3 \u0032\u20E3 \u0033\u20E3 \u0034\u20E3 \u0035\u20E3 \u0036\u20E3 \u0037\u20E3 \u0038\u20E3 \u0039\u20E3 \ud83c\udde6 \ud83c\udde7 \ud83c\udde8 \ud83c\udde9 \ud83c\uddea \ud83c\uddeb \ud83c\uddec \ud83c\udded \ud83c\uddee \ud83c\uddef \ud83c\uddf0 \ud83c\uddf1 \ud83c\uddf2 \ud83c\uddf3 \ud83c\uddf4 \ud83c\uddf5 \ud83c\uddf6 \ud83c\uddf7 \ud83c\uddf8 \ud83c\uddf9 \ud83c\uddfa \ud83c\uddfb \ud83c\uddfc \ud83c\uddfd \ud83c\uddfe \ud83c\uddff ❤️ 🧡 💛 💚 💙 💜 🤎 🟥 🟧 🟨 🟩 🟦 🟪 🟫 🔴 🟠 🟡 🟢 🔵 🟣 🟤"
}
```
*(The emojis are number 0-9, then letters a-z, then hearts, squares and disks. You can change them but please think about colorblind people !)*

Set the name of your bot on the **BOT_NAME** field. The lowercased version of this value will be the prefix for all bot's commands.\
\
Create a twitch app [here](https://dev.twitch.tv/console/apps), and fill the **TWITCH_APP_CLIENT_ID** and **TWITCH_APP_CLIENT_SECRET** values.\
\
You can leave the **TWITCH_APP_SCOPES** empty.\
\
The **LANGUAGE** field only supports "en" or "fr" values. Check the file `labels.json` for available values.\
\
Write anything you want on the **TWITCH_EVENTSUB_SECRET**. Must be between 10 and 100 chars.\
\
**PUBLIC_SECURED_URL** is the public HTTPS URL of your server that will receive EventSub notifications from twitch. If working locally you can use NGrok to create a secured tunnel to your local.\
\
Set your twitch login on **TWITCH_LOGIN** field.\
\
Set your twitch user ID on **TWITCH_USER_ID** field.\
\
Create a discord app and bot [here](https://discord.com/developers/applications), and fill the **DISCORDBOT_TOKEN** with the and the **DISCORDBOT_CLIENT_ID** values.
\
The **CMD_PREFIX** field is here to add a prefix to all the slah commands if you wish to.
The **TIMEZONE_OFFSET** field is here to make birthdays announcement at midnight for your physical timezone. If your server is set to UTC but you live in France *(UTC +2)*, you'll want to set `2` as the `TIMEZONE_OFFSET` offset so the birthdays are announce at midnight instead of 2am.
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
