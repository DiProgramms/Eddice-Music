require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection, StreamType } = require('@discordjs/voice'); 
const ytdl = require('@distube/ytdl-core')
const { parse } = require('path');
const { error } = require('console');
const yts = require('yt-search');


const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel]
});

const prefix ='!ed'; //Prefixo para os comandos
const queue = new  Map();

client.once('ready', () => {
    console.log(`✅ Logado como ${client.user.tag}`);
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const serverQueue = queue.get(message.guild.id);

    if(command === 'help') {
        //Lógica para exibir informações de ajuda 
        const helpMessage = `
        **🎵 Comandos disponíveis:**
        - \`!ed play [link]\` — Toca música do YouTube ou Spotify.
        - \`!ed pause\` — Pausa a música.
        - \`!ed resume\` — Retoma a música.
        - \`!ed stop\` — Para e limpa a fila.
        - \`!ed skip\` — Pula a faixa.
        - \`!ed repeat current\` — Ativa/desativa repetição.
        - \`!ed roll 1d20+5\` — Rola um dado.
        `;
        return message.channel.send(helpMessage);
    }

    if(command === 'play') {    
        //Lógica para reproduzir música usando ytdl

        const voiceChannel = message.member.voice.channel;
        if(!voiceChannel) return message.reply('Você precisa estar em um canal de voz para usar esse comando!');

        let query = args.join(' ');
        if (!query) return message.channel.send('❌ Você precisa fornecer um link ou nome da música.');

         //Busca no Youtube
         const ytSearch = await youtubeSearch(query);
         if(!ytSearch) return message.channel.send('❌ Música não encontrada no YouTube.');
         
         if(!await ytdl.validateURL(ytSearch)){
            return message.channel.send('❌ O link retornado não é um vídeo válido do YouTube.');
         }
         let serverQueue = queue.get(message.guild.id);

         if (serverQueue){
            serverQueue.songs.push(ytSearch);
            return message.channel.send(`➕ Música adicionada à fila: ${ytSearch}`);

         }

         const player = createAudioPlayer();
         const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator

         });

        serverQueue = {
            connection,
            player,
            songs: [ytSearch],
            repeat: false,
            startTime: 0,
            stopTime: null,
            textChannel: message.channel
         };

        queue.set(message.guild.id, serverQueue);
        connection.subscribe(player);
        
        playNextSong(message.guild.id);
    }
        
    if(command === 'pause'){
            //Lógica para pausar a música
            if(serverQueue && serverQueue.player){
                serverQueue.player.pause();
                message.channel.send('Música pausada.');
            }
        }        

    if(command === 'resume'){
        //Lógica para retomar a reprodução da música pausada
        if(serverQueue && serverQueue.player){
            serverQueue.player.unpause();
            message.channel.send('▶️ Música retomada.');  
        }
    }

    if(command === 'restart'){
        if(!serverQueue) return message.channel.send('Nenhuma música para reiniciar');

        const currentUrl = serverQueue.songs[0];
        let stream;
        try {
           stream = ytdl(currentUrl, {
                filter: 'audioonly',
                quality: 'highestaudio',
                highWaterMark: 1 << 25,
                dlChunkSize: 0,
            });
            const resource = createAudioResource(stream, {
                inputType: StreamType.Arbitrary,
            });

            serverQueue.player.play(resource);
            message.channel.send('🔄 Música reiniciada.');

            serverQueue.player.once(AudioPlayerStatus.Idle, () => {
                if (!serverQueue.repeat) serverQueue.songs.shift();
                playNextSong(message.guild.id); 
           });

            serverQueue.player.once('error', error =>{
                console.error('Erro no player (restart):', error);
                serverQueue.textChannel.send('❌ Erro ao reiniciar a música.');
                serverQueue.songs.shift();
                playNextSong(message.guild.id);
            });

        } catch (err) {
            console.error('Erro ao criar o stream:', err);
            serverQueue.textChannel.send('❌ Erro ao reiniciar a música. Pulando...');
            serverQueue.songs.shift();
            return playNextSong(guildId);
        }
    
    }

    if(command === 'stop'){
        //Lógica para parar completamente a música e limpar a fila.
        if(!serverQueue) return message.channel.send('Nenhuma música está sendo reproduzida.');
        if(serverQueue.connection){
            serverQueue.connection.destroy();
            queue.delete(message.guild.id);
            message.channel.send('⏹ Música parada e fila limpa.');
        }else{
            message.channel.send('❌ Erro ao parar a música.');
        }
    }
   
    if(command === 'skip'){
        //Lógica para pular para a próxima música na fila
        if(serverQueue && serverQueue.player){
            serverQueue.player.stop();
            message.channel.send('⏭ Música pulada.');
        }
    } 
    
    if(command === 'back'){
        if(!serverQueue || serverQueue.songs.length < 2) 
            return message.channel.send('Não há música para voltar');

        // Move a música atual para o fim e puxa a anterior pra tocar agora
        const current = serverQueue.songs.shift();
        serverQueue.songs.unshift(serverQueue.songs.pop());
        serverQueue.songs.unshift(current);

        try {
            const stream = ytdl(serverQueue.songs[0], {
                filter: 'audioonly',
                quality: 'highestaudio',
                highWaterMark: 1 << 25,
                dlChunkSize: 0,
            });

            const resource = createAudioResource(stream, {
                inputType: StreamType.Arbitrary,
            });

            serverQueue.player.play(resource);
            message.channel.send('⏮ Voltando para a música anterior.');

            serverQueue.player.once(AudioPlayerStatus.Idle, () => {
                if (!serverQueue.repeat) serverQueue.songs.shift();
                playNextSong(message.guild.id);
            });

            serverQueue.player.once('error', error => {
                console.error('Erro no player (back):', error);
                serverQueue.textChannel.send('❌ Erro ao reproduzir a música.');
                serverQueue.songs.shift();
                playNextSong(message.guild.id);
            });
        } catch (err) {
            console.error('Erro ao voltar música:', err);
            message.channel.send('❌ Erro ao voltar para a música anterior.');
        }
    }

    if(command === 'starttime' && args[0]){
       const time = parseInt(args[0]);
       if (isNaN(time) || time <0) return message.channel.send('⛔ Tempo inválido.');

       if (!serverQueue) return message.channel.send('Nenhuma música está sendo reproduzida.');

       serverQueue.startTime = time;
       message.channel.send(`⏱ Ínicio definido para ${time}s. Use \`!ed play [link]\` novamente para aplicar`);
    }

    if(command ==='stoptime' && args [0]){
        const time = parseInt(args[0]);
        if (isNaN(time) || time < 0) return message.channel.send('⛔ Tempo inválido.');

        if(!serverQueue) return message.channel.send('Nenhuma música está sendo reproduzida.');

        serverQueue.stopTime = time;
        message.channel.send(`⏱ Término definido para ${time}s. (Ainda precisa ser implementado com timeout)`);
    }

    if(command === 'repeat' && args[0] === 'current'){
        //Lógica para ativar/desativar o modo de repetição da música atual
        if(serverQueue){
           serverQueue.repeat = !serverQueue.repeat;
           message.channel.send(`🔁 Repetição ${serverQueue.repeat ? 'ativada' : 'desativada'}.`);
            }

    }

    if(command === 'fila'){
        if(!serverQueue || serverQueue.songs.length === 0)
            return message.channel.send('📭 A fila está vazia.');
        
        const fila = serverQueue.songs.map((song, i) => `${i+ 1}. ${song}`).join('\n');
        message.channel.send(`📃 **Fila de Reprodução:**\n${fila}`);
    }

    if(command === 'clear'){
        if(serverQueue){
            serverQueue.songs = [];
            message.channel.send('🧹 Fila limpa.');
        }
    }

    if(command === 'roll') {
        //Lógica para rolar dados
        const rollCommand = args.join(' ');
        try{
            const result = rollDice(rollCommand);
            message.channel.send(`🎲 Resultado: ${result}`);
        }catch(err){
            message.channel.send(`❌ Erro: ${err.message}`);
        }
    }
});

async function playNextSong(guildId) {
    const serverQueue = queue.get(guildId);
    if (!serverQueue || serverQueue.songs.length === 0){
        if(serverQueue && serverQueue.connection){
            serverQueue.connection.destroy();
        }
        queue.delete(guildId);
        return;
    }

    const currentSong = serverQueue.songs[0];
    try {
        const songInfo = await ytdl.getInfo(currentSong);
        const stream = ytdl.downloadFromInfo(songInfo, {
            filter: 'audioonly',
            quality: 'highestaudio',
            highWaterMark: 1 << 25,
            dlChunkSize: 0,
        });
        const resource = createAudioResource(stream, {
            inputType: StreamType.Arbitrary,
            metadata: songInfo,
        });

        serverQueue.player.play(resource);
        serverQueue.textChannel.send(`🎶 Tocando agora: ${currentSong}`);

        const stopAfter = serverQueue.stopTime - (serverQueue.startTime || 0);
        if(!isNaN(stopAfter) && stopAfter > 0){
            setTimeout(() => {
                serverQueue.player.stop();
                serverQueue.textChannel.send('⏱ Música interrompida no stopTime.');
            }, stopAfter * 1000);
        }
    
        serverQueue.player.once(AudioPlayerStatus.Idle, () =>{
            if (!serverQueue.repeat)
                serverQueue.songs.shift();
            playNextSong(guildId);
        });
    
        serverQueue.player.once('error', error => {
            console.error('Erro no player:', error);
            serverQueue.textChannel.send('❌ Erro ao reproduzir a música.');
            serverQueue.songs.shift();
            playNextSong(guildId);
        });

    } catch (err) {
        console.error('Erro ao criar o stream:', err);
        serverQueue.textChannel.send('❌ Erro ao acessar a música. Pulando...');
        serverQueue.songs.shift();
        return playNextSong(guildId);
    }
        
}

function rollDice(rollCommand){
    const match = rollCommand.match(/^(\d+)d(\d+)([+-]\d+)?$/);
    if (!match) throw new Error('Formato inválido. Use por exemplo: 1d20+5');

    const [, diceCount, diceSides, modifier] = match.map((x, i) => (i > 0 ? Number(x) : x));
    let total = 0;

    for (let i = 0; i < diceCount; i++) {
        total += Math.floor(Math.random() * diceSides) +1;
    }

    if(modifier) total += modifier;
    return total;
 }

 async function youtubeSearch(query) {
    try{
        const ytSearch = require('yt-search');
        const result = await ytSearch(query);

        if(result && result.videos && result.videos.length > 0){
            return result.videos[0].url;
        }else{
            console.log('Nenhum vídeo encontrado para:', query);
            return null;
        }
    }catch(error){
        console.error('Erro ao buscar no Youtube:', error);
        return null;
    }
 }

client.login(process.env.TOKEN);