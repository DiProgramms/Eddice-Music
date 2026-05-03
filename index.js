require('dotenv').config();
require('dns').setDefaultResultOrder('ipv4first');

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, StreamType} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const { setGlobalDispatcher, Agent } = require('undici');
// ... logo depois dos imports

const client = new Client({ intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, 
    GatewayIntentBits.GuildVoiceStates
    ], 
    partials: [Partials.Channel, Partials.Message] })
// ... logo após const player = createAudioPlayer();


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

    - \`!ed salvar <nome>\` - Salva uma música no diretório.
    - \`!ed play <nome>\` — Toca música do diretório.
    - \`!ed fila\` - Mostra a fila atual.
    - \`!ed resume\` — Retoma a música.
    - \`!ed pause\` — Pausa a música.
    - \`!ed stop\` — Para e limpa a fila.
    - \`!ed skip\` — Pula a faixa.
    - \`!ed back\` — Volta para a faixa anterior.
    - \`!ed repeat current\` — Ativa/desativa repetição.
    - \`!ed starttime <s>\` — Define início da faixa.
    - \`!ed stoptime <s>\` — Define término da faixa.
    - \`!ed restart\` — Reinicia a faixa atual.
    - \`!ed roll 1d20+1d12-3\` — Rola múltiplos dados.
    `
    ;
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
        const nomeEntrada = args[0];
        const nomeArquivo = nomeEntrada.endsWith('.mp3') ? nomeEntrada : `${nomeEntrada}.mp3`;
        const caminho = path.join(MUSICAS_DIR, nomeArquivo);

        if (!fs.existsSync(caminho)){
            return message.channel.send(`❌ Música não encontrada: ${nomeArquivo}`);
        }

        const VoiceChannel = message.member.voice.channel;
        if(!VoiceChannel) return message.channel.send('Entre em um canal de voz!');

        if(!serverQueue){
            const VoiceChannel = message.member.voice.channel;

            if(!VoiceChannel.joinable) {
                return message.channel.send('❌ Você precisa estar em um canal de voz para tocar música!');
            }

            await new Promise(resolve => setTimeout(resolve, 1000)); 

            const connection = joinVoiceChannel ({ 
                channelId: VoiceChannel.id, 
                guildId: VoiceChannel.guild.id, 
                adapterCreator: VoiceChannel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });
            
            connection.configureNetworking(); 

            try{
                console.log('[DEBUG] Esperando conexão ficar pronta...');
                await entersState(connection, VoiceConnectionStatus.Ready, 60_000);
                console.log('[DEBUG] Conexão pronta!');

                const player = createAudioPlayer();
                const q = { connection, player, songs: [{ title: nomeArquivo, path: caminho}]
            };

            console.log('[DEBUG] Conectado com sucesso!');
            connection.subscribe(player);
            queue.set(message.guild.id, q);
            console.log('[DEBUG] Fila configurada.');

            play(q);

            }catch(err){
                console.log('[DEBUG] Status atual da conexão:', connection.state.status);
                console.error('[DEBUG] ERRO DE CONEXÃO:', err);
                connection.destroy();
                return message.channel.send('❌ Erro ao conectar ao canal de voz.');
            }
            
        } else {
            serverQueue.songs.push({ title: nomeArquivo, path: caminho});
            message.channel.send(`Adicionado à fila: ${nomeArquivo}`);
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
    console.log('[DEBUG] Iniciando função play');

    if(q.songs.length === 0){

        console.log('[DEBUG] Fila vazia, desconectando...');
        q.connection.destroy();
        queue.delete(q.connection.joinConfig.guildId);
        return;
    }

    const song = q.songs[0];

    console.log(`[DEBUG] Tocando música: ${song.title}`);

    if (!q.player.listeners('stateChange').length) {

        console.log('[DEBUG] Configurando eventos do player pela primeira vez');

        q.player.on('stateChange', (oldState, newState) => {
        console.log(`[DEBUG] Player mudou de ${oldState.status} para ${newState.status}`);
        });

        q.player.on('error', error => {
        console.error('[DEBUG] Erro fatal no Player:', error);
        });
    }

    try{
        const resource = createAudioResource(song.path, {
            inputType: StreamType.Arbitrary
        });
        
        console.log(`[DEBUG] Tentando tocar: ${song.path}`); // Veja se isto aparece no terminal

        q.player.play(resource);

        q.player.once(AudioPlayerStatus.Idle, () => {
            q.songs.shift();
            play(q);
        });
    } catch (err){
        console.error("Erro ao criar recurso de áudio:", err);
        q.songs.shift();
        play(q);
    }
    
    console.log(`[DEBUG] Recurso de áudio criado para: ${song.path}`);
    console.log('[DEBUG] Eventos do player configurados.');
    console.log('[DEBUG] Música iniciada.');

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