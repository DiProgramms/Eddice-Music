require('dotenv').config();

const youtubeCookie = process.env.YOUTUBE_COOKIES;
if(!youtubeCookie) {
    console.error('❌ YOUTUBE-COOKIES não definido. Verifique o arquivo .env.');
    process.exit(1);
}
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


const play = require('play-dl');
play.setToken({ youtube: { cookie: youtubeCookie,} });

// Estratégias adicionais para reduzir 429:
// 1. Exponential backoff em caso de 429
// 2. Cache de resultados de search (cache simples em memória)
// 3. Introduzir delays aleatórios entre requisições
// 4. Usar play.authorization() interativo para gerar .data/youtube.data

const searchCache = new Map();

async function searchWithRetry(query, limit = 1, retries = 3, delay = 100){
    if(searchCache.has(query)){
        return searchCache.get(query);
    }

    for (let i = 0; i < retries; i++){
        try {
            await new Promise(resolve => setTimeout(res, delay *Math.random()));
            const results = await play.search(query, { limit });
            searchCache.set(query, results);
            return results;

        } catch (err) {
            if(err.statusCode === 429){
                const backoff = delay * Math.pow(2, i);
                console.warn(`⚠️ 429 recebido. Retry em ${backoff}ms (tentativa ${i + 1}/${retries})`);
                await new Promise(resolve => setTimeout(res, backoff));
                continue;
        }
        throw err;
     }
    }
throw new Error('Muitas requisições - tente novamente mais tarde.');
}

async function streamWithRetry(url, option = { discordPlayerCompatibility: true}, retries = 2, delay = 1000){
    for (let i = 0; i < retries; i++){
        try {
            return await play.stream(url, option);
        } catch (err) {
            if(err.statusCode === 429){
                const backoff = delay * Math.pow(2, i);
                console.warn(`⚠️ 429 no stream. Retry em ${backoff}ms (tentativa ${i + 1}/${retries})`);
                await new Promise(res => setTimeout(res, backoff));
                continue;
            }
        throw err;
        }
       }
       throw new Error('');
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

        const isLink = play.yt_validate(query) === 'video';
        const results = isLink 
        ? [{ title: query, url: query}] 
        : await searchWithRetry(query);

        if (!results.length) return message.channel.send('Nenhum resultado encontrado.');
        const song = { title: results[0].title, url: results[0].url };

        if (serverQueue) {
            serverQueue.songs.push(song);
            return message.channel.send(`✅ Adicionado à fila: ${song.title}`);
        }

        const queueContruct = {
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
        queue.set(message.guild.id, queueContruct);

        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator
            });

            const player = createAudioPlayer({ behaviors: { noSubscriberBehavior: NoSubscriberBehavior.Pause } });
            connection.subscribe(player);
            queueContruct.connection = connection;
            queueContruct.player = player;
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
        const ytStream = await streamWithRetry(song.url);
        const resource = createAudioResource(ytStream.stream, { 
            inputType: ytStream.type || StreamType.Arbitrary, 
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