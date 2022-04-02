// Load ENV Vars
require('dotenv').config();

// Import Packages
const { Builders, ValorantXmppClient } = require('valorant-xmpp-client');
const { Client, Intents } = require('discord.js');
const Valorant = require('@liamcottle/valorant.js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express'); // Required for https://fly.io deployment , I have no idea if this helps or not
const { default: axios } = require('axios');

const { STATUS_BOARD_CHANNEL_ID, STATUS_BOARD_MESSAGE_ID, RIOT_USERNAME, RIOT_TAGLINE, BANNER_IMAGE_URL, UPDATE_EVERY_X_MINUTES } = require('./config.json');
const { GAME_TYPE_MAP } = require('./constants.json');

const ValorantAPI = new Valorant.API(Valorant.Regions.AsiaPacific);
const { PresenceBuilder, KeystonePresenceBuilder, ValorantPresenceBuilder } = Builders;
const discordClient = new Client({ intents: [Intents.FLAGS.GUILDS] });
const supabaseClient = createClient(process.env.SUPABASE_ENDPOINT, process.env.SUPABASE_ANONKEY);

// const converter = new showdown.Converter();
const xmppClient = new ValorantXmppClient();
const app = express();
const version = 'v1.0.0-BETA';

let uuid_map = {};
let status_map = {};
let RIOT_ENTITLEMENT_TOKEN = process.env.RIOT_ENTITLEMENT_TOKEN;
let RIOT_BEARER_TOKEN = process.env.RIOT_BEARER_TOKEN;
// Task to Update Status Board
const updateStatusBoard = async () => {

    let msgString = '```\n';
    Object.keys(status_map).forEach((key) => {
        if (status_map[key].toString().toLowerCase().trim().startsWith('away')) {
            msgString += "🟡 ";

        } else {
            msgString += "🟢 ";
        }
        msgString = msgString + key.toString().split("#")[0] + " ➔ " + status_map[key] + "\n";


    });
    msgString += '```'

    var res = await axios.patch('https://discord.com/api/v8/channels/' + STATUS_BOARD_CHANNEL_ID.toString() + '/messages/' + STATUS_BOARD_MESSAGE_ID, {
        "content": "",
        "embeds": [
            {
                "type": "rich",
                "title": `Friends Online`,

                "description": `Send Friend Request to \`${RIOT_USERNAME}#${RIOT_TAGLINE}\` to be listed`,
                // "color": `0x181717`,
                "fields": [
                    {
                        "name": "\u200B",
                        "value": msgString == "```\n```" ? "`⚪️ All Friends Offline`" : msgString
                    }
                ],
                "image": {
                    "url": BANNER_IMAGE_URL,
                    "height": 0,
                    "width": 0
                },
                "footer": {
                    "text": `Powered By Cypher ${version} | Updated Every ${UPDATE_EVERY_X_MINUTES} Minutes`,
                }
            }
        ]
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bot ' + process.env.TOKEN,
        }
    }).catch((e) => { console.log(e) });
    console.log(`Updated Status Board - ${res.status}`);
    setTimeout(updateStatusBoard, 1000 * 60 * UPDATE_EVERY_X_MINUTES);
}

// Retrieve UUIDs from DB
supabaseClient.from('uuid_map').select().then((users, error) => {
    if (error) {
        console.log("Failed to Retrieve UUID Map");
        return null;
    } else {
        console.log("Retrieved UUID Map");

        users['data'].forEach(element => {
            uuid_map[element['uuid']] = {
                'display_name': element['display_name'],
                'game_name': element['game_name'],
                'tag_line': element['tag_line'],
            };
        });
    }
});

// Update Access and Entitlement Token
ValorantAPI.authorize(process.env.RIOT_USERNAME, process.env.RIOT_PASSWORD).then(() => {
    console.log(`Successfully authenticated using RSO as ${process.env.RIOT_USERNAME}`);
    RIOT_BEARER_TOKEN = ValorantAPI.access_token;
    RIOT_ENTITLEMENT_TOKEN = ValorantAPI.entitlements_token;
}).catch((err) => {
    console.log('Authentication failed with RSO: ' + err);
});

// XMPP Client Callbacks
xmppClient.presence = new PresenceBuilder()
    .addKeystonePresence(new KeystonePresenceBuilder())
    .addValorantPresence(new ValorantPresenceBuilder());
xmppClient.once('ready', () => {
    console.log('Ready to recieve presence updates');
});



// XMPP Presence Update Callback
xmppClient.on('presence', async (data) => {
    var uuid = data['sender']['local'];
    // If Update Sender is self , exit
    if (uuid === process.env.RIOT_PUUID) {
        return;
    }
    console.log('Presence Update Recieved');
    // If not , continue
    // Get Player Data

    var player = uuid_map[uuid];

    if (player == undefined) {
        axios.request({
            method: 'PUT',
            url: 'https://pd.ap.a.pvp.net/name-service/v2/players',
            data: [PUUID],
            headers: {
                'Content-Type': 'application/json',
                'X-Riot-Entitlements-JWT': RIOT_ENTITLEMENT_TOKEN,
                Authorization: 'Bearer ' + RIOT_BEARER_TOKEN
            }
        }).then(function (response) {
            let player_data = response.data[0];
            supabaseClient.from('uuid_map').insert({
                uuid: player_data['Subject'],
                display_name: player_data['DisplayName'],
                game_name: player_data['GameName'],
                tag_line: player_data['TagLine'],
            }).then((_) => {
                player = {
                    'display_name': player_data['DisplayName'],
                    'game_name': player_data['GameName'],
                    'tag_line': player_data['TagLine'],
                };

            }).catch((err) => {
                console.log(err);
            });

        }).catch((err) => {
            console.log(err);
        });

    }

    // If Presence is null , remove player from board
    if (data['gamePresence'] == null) {
        try {
            delete status_map[player['game_name'] + "#" + player['tag_line']];
        } catch (e) {

        }
        return;
    }

    // If only keystone presence data , exit
    else if (data['gamePresence'][0]['type'] == 'keystone' && data['gamePresence'].length == 1) return;

    // If both keystone and game presence
    else if (data['gamePresence'][0]['type'] == 'keystone' && data['gamePresence'].length > 1) {
        var presence = data['gamePresence'][1]['presence'];
        var presenceType = data['gamePresence'][1]['type'];
        switch (presenceType) {
            case 'valorant':
                // TODO: Refactor this at some point
                let sessionState = presence['sessionLoopState'];
                let queueID = presence['queueId'];
                let queue = "";
                let status = "";
                let scoreString = "";
                let discordStatusString = "";
                switch (sessionState) {
                    case "MENUS":
                        status = "In Lobby";
                        break;
                    case "PREGAME":
                        status = "Agent Select";
                        break;
                    case "INGAME":
                        status = null;
                        break;
                }
                switch (queueID) {
                    case 'unrated':
                        queue = "Unrated";
                        break;
                    case 'competitive':
                        queue = "Competitive";
                        break;
                    case 'deathmatch':
                        queue = "Deathmatch";
                        break;
                    case 'spikerush':
                        queue = "Spike Rush";
                        break;
                    case 'snowball':
                        queue = "Snowball Fight";
                        break;
                    case 'replication':
                        queue = "Replication";
                        break;
                    case 'ggteam':
                        queue = "Escalation";
                        break;
                    default:
                        queue = "Unknown"
                        break;
                }

                if (presence['isIdle']) {
                    if (presence['customGameTeam'] !== "") {
                        discordStatusString = "Away";
                    } else {
                        discordStatusString = "Away";
                    }
                } else {
                    if (status == null) {
                        if (presence['customGameTeam'] !== "") {
                            scoreString = presence['partyOwnerMatchScoreAllyTeam'].toString() + "-" + presence['partyOwnerMatchScoreEnemyTeam'].toString();
                            discordStatusString = "Custom | " + scoreString;
                        } else if (presence['matchMap'] == "/Game/Maps/Poveglia/Range") {
                            discordStatusString = "The Range";
                        }
                        else {
                            scoreString = presence['partyOwnerMatchScoreAllyTeam'].toString() + "-" + presence['partyOwnerMatchScoreEnemyTeam'].toString();
                            discordStatusString = queue + " | " + scoreString;

                        }
                    } else {
                        if (presence['customGameTeam'] !== "") {
                            discordStatusString = status + " | Custom";
                        } else if (presence['matchMap'] == "/Game/Maps/Poveglia/Range") {
                            discordStatusString = "The Range";
                        } else {
                            discordStatusString = status + " | " + queue;
                        }
                    }


                }
                if (status_map[player['game_name'] + "#" + player['tag_line']] != discordStatusString) {

                    status_map[player['game_name'] + "#" + player['tag_line']] = discordStatusString;


                }

                break;

            case 'league_of_legends':
                status_map[player['game_name'] + "#" + player['tag_line']] = GAME_TYPE_MAP['league_of_legends'];

                break;

            default:
                status_map[player['game_name'] + "#" + player['tag_line']] = GAME_TYPE_MAP['other'];
                console.log('Unknown Game', data['gamePresence'][1]);
                break;

        }
    }
    else if (data['gamePresence'][1]['type'] == 'keystone' && data['gamePresence'].length > 1) {
        var presence = data['gamePresence'][0]['presence'];
        var presenceType = data['gamePresence'][0]['type'];
        switch (presenceType) {
            case 'valorant':
                // TODO: Refactor this at some point
                let sessionState = presence['sessionLoopState'];
                let queueID = presence['queueId'];
                let queue = "";
                let status = "";
                let scoreString = "";
                let discordStatusString = "";
                switch (sessionState) {
                    case "MENUS":
                        status = "In Lobby";
                        break;
                    case "PREGAME":
                        status = "Agent Select";
                        break;
                    case "INGAME":
                        status = null;
                        break;
                }
                switch (queueID) {
                    case 'unrated':
                        queue = "Unrated";
                        break;
                    case 'competitive':
                        queue = "Competitive";
                        break;
                    case 'deathmatch':
                        queue = "Deathmatch";
                        break;
                    case 'spikerush':
                        queue = "Spike Rush";
                        break;
                    case 'snowball':
                        queue = "Snowball Fight";
                        break;
                    case 'replication':
                        queue = "Replication";
                        break;
                    case 'ggteam':
                        queue = "Escalation";
                        break;
                    default:
                        queue = "Unknown"
                        break;
                }

                if (presence['isIdle']) {
                    if (presence['customGameTeam'] !== "") {
                        discordStatusString = "Away";
                    } else {
                        discordStatusString = "Away";
                    }
                } else {
                    if (status == null) {
                        if (presence['customGameTeam'] !== "") {
                            scoreString = presence['partyOwnerMatchScoreAllyTeam'].toString() + "-" + presence['partyOwnerMatchScoreEnemyTeam'].toString();
                            discordStatusString = "Custom | " + scoreString;
                        } else if (presence['matchMap'] == "/Game/Maps/Poveglia/Range") {
                            discordStatusString = "The Range";
                        }
                        else {
                            scoreString = presence['partyOwnerMatchScoreAllyTeam'].toString() + "-" + presence['partyOwnerMatchScoreEnemyTeam'].toString();
                            discordStatusString = queue + " | " + scoreString;

                        }
                    } else {
                        if (presence['customGameTeam'] !== "") {
                            discordStatusString = status + " | Custom";
                        } else if (presence['matchMap'] == "/Game/Maps/Poveglia/Range") {
                            discordStatusString = "The Range";
                        } else {
                            discordStatusString = status + " | " + queue;
                        }
                    }


                }
                if (status_map[player['game_name'] + "#" + player['tag_line']] != discordStatusString) {

                    status_map[player['game_name'] + "#" + player['tag_line']] = discordStatusString;


                }

                break;

            case 'league_of_legends':
                status_map[player['game_name'] + "#" + player['tag_line']] = GAME_TYPE_MAP['league_of_legends'];

                break;

            default:
                status_map[player['game_name'] + "#" + player['tag_line']] = GAME_TYPE_MAP['other'];
                console.log('Unknown Game', data['gamePresence'][1]);
                break;

        }
    }

    // If only game presence
    else if (data['gamePresence'][0]['type'] != 'keystone' && data['gamePresence'].length == 1) {
        var presence = data['gamePresence'][0]['presence'];
        var presenceType = data['gamePresence'][0]['type'];
        switch (presenceType) {
            case 'valorant':
                // TODO: Refactor this at some point
                let sessionState = presence['sessionLoopState'];
                let queueID = presence['queueId'];
                let queue = "";
                let status = "";
                let scoreString = "";
                let discordStatusString = "";
                switch (sessionState) {
                    case "MENUS":
                        status = "In Lobby";
                        break;
                    case "PREGAME":
                        status = "Agent Select";
                        break;
                    case "INGAME":
                        status = null;
                        break;
                }
                switch (queueID) {
                    case 'unrated':
                        queue = "Unrated";
                        break;
                    case 'competitive':
                        queue = "Competitive";
                        break;
                    case 'deathmatch':
                        queue = "Deathmatch";
                        break;
                    case 'spikerush':
                        queue = "Spike Rush";
                        break;
                    case 'snowball':
                        queue = "Snowball Fight";
                        break;
                    case 'replication':
                        queue = "Replication";
                        break;
                    case 'ggteam':
                        queue = "Escalation";
                        break;
                    default:
                        queue = "Unknown"
                        break;
                }

                if (presence['isIdle']) {
                    if (presence['customGameTeam'] !== "") {
                        discordStatusString = "Away";
                    } else {
                        discordStatusString = "Away";
                    }
                } else {
                    if (status == null) {
                        if (presence['customGameTeam'] !== "") {
                            scoreString = presence['partyOwnerMatchScoreAllyTeam'].toString() + "-" + presence['partyOwnerMatchScoreEnemyTeam'].toString();
                            discordStatusString = "Custom | " + scoreString;
                        } else if (presence['matchMap'] == "/Game/Maps/Poveglia/Range") {
                            discordStatusString = "The Range";
                        }
                        else {
                            scoreString = presence['partyOwnerMatchScoreAllyTeam'].toString() + "-" + presence['partyOwnerMatchScoreEnemyTeam'].toString();
                            discordStatusString = queue + " | " + scoreString;

                        }
                    } else {
                        if (presence['customGameTeam'] !== "") {
                            discordStatusString = status + " | Custom";
                        } else if (presence['matchMap'] == "/Game/Maps/Poveglia/Range") {
                            discordStatusString = "The Range";
                        } else {
                            discordStatusString = status + " | " + queue;
                        }
                    }


                }
                if (status_map[player['game_name'] + "#" + player['tag_line']] != discordStatusString) {

                    status_map[player['game_name'] + "#" + player['tag_line']] = discordStatusString;


                }

                break;

            case 'league_of_legends':
                status_map[player['game_name'] + "#" + player['tag_line']] = GAME_TYPE_MAP['league_of_legends'];

                break;

            default:
                status_map[player['game_name'] + "#" + player['tag_line']] = GAME_TYPE_MAP['other'];
                console.log('Unknown Game', data['gamePresence'][1]);
                break;

        }
    }

});


xmppClient.on('error', (err) => {
    console.log('XMPP | Client Error: ' + err);

});

// Discord Client Callbacks
discordClient.on('ready', async () => {
    console.log(`DISCORD | Logged in as ${discordClient.user.tag}!`);
    discordClient.user.setActivity('Valorant', { type: 'PLAYING' });
    await axios.patch('https://discord.com/api/v8/channels/' + STATUS_BOARD_CHANNEL_ID.toString() + '/messages/' + STATUS_BOARD_MESSAGE_ID, {
        "content": "",
        "embeds": [{
            "type": "rich",
            "title": `Waiting for Presence Update`,
            "description": `Send Friend Request to  \`${RIOT_USERNAME}#${RIOT_TAGLINE}\` to be listed`,
            // "color": EMBED_COLOR,
            "fields": [
                {
                    "name": "\u200B",
                    "value": `\`⚪️ All Friends Offline\``
                }
            ],
            "image": {
                "url": BANNER_IMAGE_URL,
                "height": 0,
                "width": 0
            },
            "footer": {
                "text": `Powered By Cypher ${version} | Updated Every ${UPDATE_EVERY_X_MINUTES} minutes`,

            }
        }]
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bot ' + process.env.TOKEN,
        }
    }).then((_) => {
        console.log('DISCORD | Status Board Message Updated');
        setTimeout(updateStatusBoard, 10000);
    }).catch(err => {
        console.log(err);
    })

});

// Startup Things
xmppClient.login({ username: process.env.RIOT_USERNAME, password: process.env.RIOT_PASSWORD });
discordClient.login(process.env.TOKEN);

// Add Command
discordClient.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    const { commandName, options } = interaction;
    if (commandName === 'add') {
        // await interaction.reply('test');
        let username = options.data[0]['value'];
        //TODO: Add Friend Using username
        try {
            throw "NotImplementedError"
            await interaction.reply('Sent Friend request to ' + username);
        } catch (err) {
            await interaction.reply('Failed to Send Friend Request: ' + err);
        }
    }
})


// Run Webserver for https://fly.io health check , no idea if this helps or no
app.get('/', (req, res) => {
    res.send('<h1>Cypher Bot</h1>');
});
app.listen(8080);