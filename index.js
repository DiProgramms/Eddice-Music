require('dotenv').config();

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus} = require('@discordjs/voice'); 

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates], partials: [Partials.Channel, Partials.Message] })

const prefix ='!ed'; //Prefixo para os comandos
const queue = new  Map();
const MUSICAS_DIR = path.join(__dirname, 'musicas');

if (!fs.existsSync(MUSICAS_DIR)) fs.mkdirSync(MUSICAS_DIR);

async function baixarMusica(attachment, nome){
    const caminho = path.join(MUSICAS_DIR, nome);
    const writer = fs.createWriteStream(caminho);
    const response = await axios({ url: attachment.url, method: 'GET', responseType: 'stream'});
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}


client.once('ready', () => console.log(`✅ Logado como ${client.user.tag}. Pronto para tocar suas músicas!`));

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

    if(command === 'salvar'){
        const nome = args[0];
        const attachment = message.attachments.first();
        if (!nome || !attachment) return message.channel.send('❌ Use: !ed salvar <nome> (anexando um áudio)');
        
        await baixarMusica(attachment, nome);
        return message.channel.send(`🎵 Música salva com sucesso: ${nome}`);
    }

    if(command === 'listar'){
        const arquivos = fs.readdirSync(MUSICAS_DIR).map(f => f.replace('.mp3', ''));
        return message.channel.send(`📜 Biblioteca:\n${arquivos.join(', ')}`);
    }

    if(command === 'play') {    
        //Lógica para reproduzir música
        const nome = args[0];
        const caminho = path.join(MUSICAS_DIR, `${nome}.mp3`);
        if (!fs.existsSync(caminho)) return message.channel.send('❌ Música não encontrada.');

        const VoiceChannel = message.member.voice.channel;
        if(!VoiceChannel) return message.channel.send('Entre em um canal de voz!');

        if(!serverQueue){
            const q = {
                connection: joinVoiceChannel({ channelId: VoiceChannel.id, guildId: message.guild.id, 
            adapterCreator: message.guild.voiceAdapterCreator}),
            player: createAudioPlayer(),
            songs: [{ title: nome, path: caminho}]
            };

            q.connection.subscribe(q.player);
            queue.set(message.guild.id, q);
            play(q);
        } else {
            serverQueue.songs.push({ title: nome, path: caminho});
            message.channel.send(`Adicionado à fila: ${nome}`);
        }
    }

    if(command === 'stop'){
        //Lógica para parar completamente a música e limpar a fila.
        if(!serverQueue) return message.channel.send('Nenhuma música está sendo reproduzida.');

        if(serverQueue.connection){
            serverQueue.connection.destroy();
            queue.delete(message.guild.id); message.channel.send('⏹ Música parada e fila limpa.');
        }else{
            message.channel.send('❌ Erro ao parar a música.');
        }
    }
     
    if(command === 'resume'){
        //Lógica para retomar a reprodução da música pausada
        if(serverQueue?.player){
            serverQueue.player.unpause();
            message.channel.send('▶️ Música retomada.');  
        }
    }

    if(command === 'pause'){
            //Lógica para pausar a música
            if(serverQueue?.player){
                serverQueue.player.pause();
                message.channel.send('Música pausada.');
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
            return message.channel.send(`🔁 Repetição ${serverQueue.repeat ? 'ativada' : 'desativada'}.`);
        }
    }

    if(command === 'fila'){
        if(!serverQueue || serverQueue.songs.length === 0)
            return message.channel.send('📭 A fila está vazia.');
        
        const fila = serverQueue.songs.map((song, i) => `${i+ 1}. ${song.title}`).join('\n');
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

function play(q){
    if(q.songs.length === 0){
        q.connection.destroy();
        queue.delete(q.connection.joinConfig.guildId);
        return;
    }
    const song = q.songs.shift();
    const resource = createAudioResource(song.path);
    q.player.play(resource);
    q.player.once(AudioPlayerStatus.Idle, () => play(q));
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