require('dotenv').config();
const { google } = require('googleapis');
const yt = google.youtube( { version: 'v3', auth: process.env.YOUTUBE_API_KEY });

const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { joinVoiceChannel, 
        createAudioPlayer,
        createAudioResource, 
        AudioPlayerStatus, 
        NoSubscriberBehavior, 
        StreamType } = require('@discordjs/voice'); 


const { Innertube } = require('youtubei.js');

let ytClient;
(async () => {
    ytClient = await Innertube.create();
})().catch(err => console.error('Erro ao inicializar o cliente do YouTube:', err));

// Estratégias adicionais para reduzir 429:
// 1. Exponential backoff em caso de 429
// 2. Cache de resultados de search (cache simples em memória)
// 3. Introduzir delays aleatórios entre requisições
// 4. Usar play.authorization() interativo para gerar .data/youtube.data

const searchCache = new Map();

async function searchYoutube(query) {
    if(searchCache.has(query)) { return searchCache.get(query); }
    const isYoutubeUrl = /^https?:\/\/(www\.)?(youtu\.be|youtube\.com)\/.+/.test(query);

    if(isYoutubeUrl){
        const direct = { title: 'Direto', url: query };
        searchCache.set(query, direct);
        return direct;
    }

    const res = await yt.search.list({ part: 'snippet', q: query, type: 'video', maxResults: 1 });
    if(!res.data.items.length) {
        throw new Error('Nenhum resultado encontrado.');
    }
    const item = res.data.items[0];
    const videoId = item.id.videoId;
    const result = {
        title: item.snippet.title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
    };
    searchCache.set(query, result);
    return result;
}

async function getAudioStream(videoURL){
    if(!ytClient){
        throw new Error('Cliente do YouTube não inicializado.');
    }
    const idMatch = videoURL.match(/v=([\w-]{11})/);
    const videoId = idMatch ? idMatch[1] : videoURL;
    const info = await ytClient.getBasicInfo(videoId);
    const format = info.chooseFormat({ filter: formats => formats.find(f => f.mimeType.startsWith('audio/')) });
    if(!format) {
        throw new Error('Formato de áudio não encontrado.');
    }
    
    const response = await fetch(format.url);
    return { stream: response.body, type: StreamType.Arbitrary };
}

app.get('/', (req, res) => res.send('Bot Online'));
app.listen(port, () => console.log(`Servidor rodando na porta ${port}`));

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

client.once('ready', () => console.log(`✅ Logado como ${client.user.tag}`));

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const serverQueue = queue.get(message.guild.id);

    if(command === 'help') {
        //Lógica para exibir informações de ajuda 
        const helpMessage = `
    **🎵 Comandos disponíveis:**
    - \`!ed play [link|nome]\` — Toca música do YouTube.
    - \`!ed pause\` — Pausa a música.
    - \`!ed resume\` — Retoma a música.
    - \`!ed stop\` — Para e limpa a fila.
    - \`!ed skip\` — Pula a faixa.
    - \`!ed back\` — Volta para a faixa anterior.
    - \`!ed repeat current\` — Ativa/desativa repetição.
    - \`!ed starttime <s>\` — Define início da faixa.
    - \`!ed stoptime <s>\` — Define término da faixa.
    - \`!ed restart\` — Reinicia a faixa atual.
    - \`!ed roll 1d20+1d12-3\` — Rola múltiplos dados.
    `;
        return message.channel.send(helpMessage);
    }

    if(command === 'play') {    
        //Lógica para reproduzir música usando ytdl
        const voiceChannel = message.member.voice.channel;
        if(!voiceChannel) return message.channel.send('Entre em um canal de voz primeiro!');

        const query = args.join (' ');
        if(!query) return message.channel.send('Forneça um link ou nome de música.');

        let song;
        try {
            song = await searchYoutube(query);
        }catch (err){
            return message.channel.send(`❌ ${err.message}`);
        }

        if(serverQueue){
            serverQueue.songs.push(song);
            return message.channel.send(`Adicionada à fila: ${song.title}`);
        }

        const queueConstruct = {
            textChannel: message.channel,
            connection: null,
            player: null,
            songs: [song],
            history: [],
            repeat: false,
            isBack: false,
            startTime: 0,
            stopTime: null,
        };
        queue.set(message.guild.id, queueConstruct);

        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator
            });
            const player = createAudioPlayer({ behaviors: { noSubscriberBehavior: NoSubscriberBehavior.Pause} });
            connection.subscribe(player);
            queueConstruct.connection = connection;
            queueConstruct.player = player;
            playNextSong(message.guild.id);
        } catch (error) {
            console.error('Erro ao conectar ao canal de voz:', error);
            queue.delete(message.guild.id);
            return message.channel.send('❌ Erro ao conectar ao canal de voz.');
        }
    }
        
    if(command === 'pause'){
            //Lógica para pausar a música
            if(serverQueue?.player){
                serverQueue.player.pause();
                message.channel.send('Música pausada.');
            }
        }        

    if(command === 'resume'){
        //Lógica para retomar a reprodução da música pausada
        if(serverQueue?.player){
            serverQueue.player.unpause();
            message.channel.send('▶️ Música retomada.');  
        }
    }

    if(command === 'restart'){
        if(!serverQueue) return message.channel.send('Nenhuma música está sendo reproduzida.');
        const last = serverQueue.history[serverQueue.history.length - 1];
        if (!last) return message.channel.send('Nenhuma música anterior para reiniciar.');
        serverQueue.songs.unshift(last);
        serverQueue.player.stop();
        return message.channel.send(`🔄 Reiniciando: ${last.title}`);
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
        if(serverQueue?.player){
            serverQueue.player.stop();
            message.channel.send('⏭ Música pulada.');
        }
    } 
    
    if(command === 'back'){
        if (!serverQueue || serverQueue.songs.length < 2    ) {
            return message.channel.send('Nenhuma música anterior para voltar.');
        }
        serverQueue.history.pop();
        const prev = serverQueue.history.pop();
        serverQueue.songs.unshift(prev);
        serverQueue.isBack = true;
        serverQueue.player.stop();
        return message.channel.send(`⏪ Voltando para: ${prev.title}`);
    }

    if(command === 'starttime' && args[0]){
       const time = parseInt(args[0], 10);
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

    if(command === 'repeat' ){
        if(args[0] === 'current'){
            serverQueue.repeat = !serverQueue.repeat;
            return messsage.channel.send(`🔁 Repetição ${serverQueue.repeat ? 'ativada' : 'desativada'}.`);
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
        try{
            const result = rollDice(args.join(' '));
            return message.channel.send(`🎲 Resultado: ${result}`);
        }catch(err){
            return message.channel.send(`❌ Erro: ${err.message}`);
        }
    }
});

async function playNextSong(guildId) {
    const serverQueue = queue.get(guildId);
    if (!serverQueue) return;

    const song = serverQueue.songs.shift();
    if(!song){
        serverQueue.connection.destroy();
        queue.delete(guildId);
        return;
    }

    serverQueue.history.push(song);
    try{
        
        const ytStream = await getAudioStream(song.url);
        const resource = createAudioResource(ytStream.stream, { 
            inputType: ytStream.type, 
            metadata: song 
        });

        serverQueue.player.play(resource);
        serverQueue.textChannel.send(`🎶 Tocando agora: ${song.title}`);

        serverQueue.player.on(AudioPlayerStatus.Idle, () => {
            if(!serverQueue.isBack && !serverQueue.repeat) serverQueue.history.pop();
                serverQueue.isBack = false;
                playNextSong(guildId);
            });
        }catch(err){
            console.error('Erro no stream', err);
            playNextSong(guildId);
        }
}

function rollDice(input){
        const terms = input.match(/([+-]?[^+-]+)/g);
        if(!terms) throw new Error('Formato Inválido.');
        let total = 0;
        for(const term of terms){
            const dice = term.match(/^([+-]?)(\d*)d(\d+)$/);
            if(dice){
                const sign = dice[1] === '-' ? -1 : 1;
                const count = parseInt(dice[2] || '1', 10);
                const sides = parseInt(dice[3], 10);
                for(let i=0; i < count; i++){
                    total += sign * (Math.floor(Math.random() * sides) + 1);
                }
            }else if(/^[+-]?\d+$/.test(term)){
                total += parseInt(term, 10);
            }else{
                throw new Error(`Formato Inválido: ${term}`);
            }
        }
        return total;
 }

client.login(process.env.TOKEN);