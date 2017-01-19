/*
 ========
 Imports
 ========
 */
var Config = require('./config.js');
var Discord = require("discord.js");
var http = require('http');
var bot = new Discord.Client();

/*
========
Commands
========
 */

var commands = {
    'ping':  {
        description: 'Responds with "pong!".',
        help: true,
        admin: false,
        method: function(msg, args){
            msg.reply('pong!');
        }
    },
    'help': {
        description: "Sends a PM to the sender with the list of the commands for the bot.",
        help: true,
        admin: false,
        method: function(msg, args){
            var message = 'Command List: ';
            message += '```';
            for(var command in commands) {
                if(commands[command].help) {
                    message += '"' + command + '"';
                    message += ' ';
                }
            }
            message += '```';
            message += 'Example Usage: @'+Config.BOT_NAME+' ping';
            msg.author.sendMessage(message);
        }
    },
    'members': {
        description: "Gives a count of the members of the server that the sender is in.",
        help: true,
        admin: false,
        method: function(msg, args){
            const count = msg.channel.guild.memberCount;
            const sname = msg.channel.guild.name;
            const mesg = 'there are ' + bold(count) + ' members in ' + bold(sname);
            msg.reply(mesg);
        }
    },
    'commits': {
        description: "Gives the commit count for the project given.",
        help: true,
        admin: false,
        method: function(msg, args){
            var rNameArg = 'src';
            if(args && args.length >= 1){
                rNameArg = args[0];
            }

            var commits = totalCommits[Config.DEFAULT_REPOSITORY_ID];
            var branchName = 'master';
            var rName = 'src';
            for(var i in repositories){
                var repository = repositories[i];
                if(repository.name == rNameArg){
                    rName = rNameArg;
                    branchName = repository.default_branch;
                    commits = totalCommits[repository.id];
                }
            }
            msg.reply('there are ' + bold(commits) + ' commits on ' + bold(rName + '/' + branchName) + '.');
        }
    },
    'describe': {
        description: 'Gives a description of the command supplied.',
        help: true,
        admin: false,
        method: function(msg, args){
            if(args && args.length){
                const cmdStr = args[0];
                if(cmdStr in commands){
                    msg.channel.sendEmbed(new Discord.RichEmbed()
                        .setTitle(cmdStr)
                        .setColor(0x000000)
                        .setDescription(commands[cmdStr].description));
                }
                else{
                    msg.reply('I don\'t know what that command is!');
                }
            }
            else{
                msg.reply('you must supply a command to know more about it.');
            }
        }
    }
};

const defaultCommand = {
    description: "Command ran when there's no command to run",
    admin: false,
    method: function(msg, args){
        msg.reply(Config.BOT_IDLE_RESPONSES[Math.floor(Math.random()*Config.BOT_IDLE_RESPONSES.length)]);
    }
};

const noAdminCommand = {
    description: "Command ran when user who used command has no admin access",
    admin: false,
    method: function(msg, args){
        msg.reply('you must have the "'+Config.ADMIN_ROLE_NAME+'" role to use this command!');
    }
};

/*
============
Message Hook

Example accepted message: "@Infinite command_name arg_1 arg_2 arg_n"
===========
 */

bot.on('message', function(msg){
    if (msg.author == bot.user) {
        return;
    }
    if(!msg.isMentioned(bot.user)){
        return;
    }
    const msgList = msg.cleanContent.split(' ');
    const mention = msgList[0];
    const command = msgList[1];
    var args = undefined;
    var cmd = defaultCommand;
    if(msgList.length > 2){
        args = msgList;
        args.shift();
        args.shift();
    }
    if(command in commands){
        cmd = commands[command];
    }
    if(cmd.admin && !msg.member.roles.exists('name', Config.ADMIN_ROLE_NAME)){
        // This user is not an admin
        cmd = noAdminCommand;
    }
    cmd.method(msg, args);
});

/*
==========
Ready Hook
==========
 */

bot.on('ready', function(){
    console.log('Ready!');
});

/*
===========
HTTP Server
===========
 */

const server = http.createServer(function(req, res){
    // Accept post requests from GitLab
    if(req.headers['x-gitlab-event'] === undefined){
        console.log('Ignoring non-gitlab request...');
    }
    else if(req.headers['x-gitlab-event'] !== 'Push Hook'){
        console.log('Unhandled gitlab request: ' + req.headers['x-gitlab-event']);
    }
    else if(req.headers['x-gitlab-token'] !== Config.GITLAB_TOKEN){
        console.log('Attempted to send request with invalid gitlab token: ' + req.headers['x-gitlab-token']);
    }
    else if(req.method !== 'POST'){
        console.log('Unhandled request method: ' + req.method);
    }
    else{
        var allData = '';
        req.on('data', function (data) {
            // We got a valid request, append this data
            allData += data;
        }).on('end', function(){
            console.log('Handling received gitlab push...');
            // We're done receiving data, push it
            handlePush(JSON.parse(allData));
        });
    }
    res.statusCode = 200;
    res.end();
});

server.listen(Config.PORT, Config.HOST, function(){
    console.log('Listening on port ' + Config.PORT + '...');
});

/*
===================
Helper Functions
===================
 */

function handlePush(request){
    // User pushed, send message and re-get total commits
    try{
        sendPublicPushMessage(request);
        sendPrivatePushMessage(request);
    }
    catch(err){
        console.log(err);
    }
    loadTotalCommits(request.project_id);
}

function sendPublicPushMessage(request){
    var branch = request.ref.split('/').slice(2).join('/');
    var msg = '';
    msg += bold(request.user_name);
    if(request.total_commits_count === 0){
        // Either creating or deleting a branch
        if(request.before == 0){
            // Created branch as the before code was all 0s
            msg += ' just created a new branch ';
        }
        else{
            // Deleted branch as the after code was all 0s
            msg += ' just deleted a branch ';
        }
    }
    else{
        msg += ' just pushed ' + bold(request.total_commits_count);
        msg += request.total_commits_count === 1 ? ' commit ' : ' commits ';
        msg += 'to ';
        msg += request.project.default_branch == branch ?
        bold(request.project.default_branch) + ' ' : 'a ' + bold('non-' + request.project.default_branch) + ' branch ';
    }
    msg += 'on ' + bold(request.project.name) + '!';
    console.log('Sending public message: ' + msg);
    const embed = new Discord.RichEmbed()
        .setColor(0x00AE86)
        .setDescription(msg)
        .setTimestamp();
    sendEmbed(embed, true);
}

function sendPrivatePushMessage(request){
    var branch = request.ref.split('/').slice(2).join('/');
    var msg = '';
    msg += bold(request.user_name);
    if(request.total_commits_count === 0){
        // Either creating or deleting a branch
        if(request.before == 0){
            // Created branch as the before code was all 0s
            msg += ' just created a new branch ' + bold(branch) + ' to ' + bold(request.project.name) + '!';
        }
        else{
            // Deleted branch as the after code was all 0s
            msg += ' just deleted branch ' + bold(branch) + ' from ' + bold(request.project.name) + '!';
        }
    }
    else{
        msg += ' pushed ' + bold(request.total_commits_count);
        msg += request.total_commits_count === 1 ? ' commit ' : ' commits ';
        msg += 'to branch ' + bold(branch) + ' of ' + bold(request.project.name) + ':';
    }
    var commits = request.commits;
    msg += '\n';
    console.log('Sending private message: ' + msg);
    const embed = new Discord.RichEmbed()
        .setTitle(request.project.name)
        .setColor(0x00AE86)
        .setDescription(msg)
        .setThumbnail(request.user_avatar)
        .setTimestamp()
        .setURL(request.project.web_url);

    for(var i in commits) {
        const commit = commits[i];
        embed.addField(commit.message, commit.author.name);
    }
    sendEmbed(embed, false);
}

function bold(string){
    return '**'+string+'**';
}

function sendMessage(msg, pub){
    // Sends a message to all configured servers and text channels
    const guilds = bot.guilds.array();
    for(var key in guilds){
        var guild = guilds[key];
        if(guild.name in Config.GUILD_TO_MAIN_CHANNEL && pub) {
            guild.channels.find('name', Config.GUILD_TO_MAIN_CHANNEL[guild.name]).sendMessage(msg);
        }
        else if(guild.name in Config.GUILD_TO_PRIVATE_CHANNEL && !pub){
            guild.channels.find('name', Config.GUILD_TO_PRIVATE_CHANNEL[guild.name]).sendMessage(msg);
        }
    }
}

function sendEmbed(emb, pub){
    // Sends an embed to all configured servers and text channels
    const guilds = bot.guilds.array();
    for(var key in guilds){
        var guild = guilds[key];
        if(guild.name in Config.GUILD_TO_MAIN_CHANNEL && pub) {
            guild.channels.find('name', Config.GUILD_TO_MAIN_CHANNEL[guild.name]).sendEmbed(emb);
        }
        else if(guild.name in Config.GUILD_TO_PRIVATE_CHANNEL && !pub){
            guild.channels.find('name', Config.GUILD_TO_PRIVATE_CHANNEL[guild.name]).sendEmbed(emb);
        }
    }
}

function loadTotalCommits(rId, callback){
    totalCommits[rId] = 0;
    getContributors(rId, function(contributors){
        for(var i in contributors){
            var contributor = contributors[i];
            totalCommits[rId] += contributor.commits;
        }
        if(callback != undefined){
            callback(rId);
        }
    });
}

var repositories = undefined;
var totalCommits = {};

console.log('Preloading repositories and commit counts...');
getRepositories(function(response){
    repositories = response;
    for(var i in repositories){
        var repository = repositories[i];
        loadTotalCommits(repository.id, function(rId){
            for(var i in repositories){
                var repository = repositories[i];
                if(repository.id == rId){
                    console.log('Loaded repository ' + repository.name + ' with ' + totalCommits[rId] + ' commits.');
                }
            }
        });
    }
});

function getRepositories(callback){
    var url = 'http://';
    url += Config.PROJECT_PATH + '/api/v3/projects';
    url += '?private_token='+Config.PRIVATE_TOKEN;
    doRequest(url, callback);
}

function getContributors(rId, callback){
    var url = 'http://';
    url += Config.PROJECT_PATH + '/api/v3/projects/';
    url += rId + '/repository/contributors';
    url += '?private_token='+Config.PRIVATE_TOKEN;
    doRequest(url, callback);
}

function doRequest(url, callback){
    var req = http.get(url, function(res) {
        // Buffer the body entirely for processing as a whole.
        var allData = '';
        res.on('data', function(data) {
            allData += data;
        }).on('end', function(){
            callback(JSON.parse(allData));
        });
    });

    req.on('error', function(e) {
        console.log('ERROR: ' + e.message);
    });
}

// Login the bot
bot.login(Config.BOT_TOKEN);