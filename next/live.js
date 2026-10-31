(() => {
  'use strict';
  window.startPrideLive = async (root, config) => {
    if (!window.supabase?.createClient) {
      root.innerHTML = '<main class="boot"><span class="boot-mark">P</span><p>Не удалось загрузить клиент Supabase. Обновите страницу.</p></main>';
      return;
    }
    const db = window.supabase.createClient(config.url, config.anonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true } });
    const walletUrl = 'https://iamskoup.github.io/pc/';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const clock = value => value ? new Date(value).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) : '';
    const sayError = error => {
      const code=error?.code||error?.error_code;
      if(code==='over_email_send_rate_limit'||error?.status===429)return 'Лимит писем подтверждения исчерпан. Попробуйте зарегистрироваться позже.';
      if(code==='email_address_invalid')return 'Проверьте адрес электронной почты.';
      if(code==='invalid_credentials')return 'Неверная почта или пароль.';
      if(code==='user_already_exists')return 'Этот адрес уже зарегистрирован.';
      return error?.message || 'Не удалось выполнить действие. Попробуйте ещё раз.';
    };
    const svg = (name, size=19) => {
      const paths={chat:'<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 3v-6a7.5 7.5 0 1 1 17-4.5Z"/>',pride:'<path d="M12 3c4 0 7 4 7 8 0 5-3 9-7 10-4-1-7-5-7-10 0-4 3-8 7-8Z"/>',users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2"/><path d="M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 5v1"/>',gift:'<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M12 8c-6 0-6-6-3-6 2 0 3 3 3 6Zm0 0c6 0 6-6 3-6-2 0-3 3-3 6Z"/>',wallet:'<rect x="2" y="5" width="20" height="16" rx="3"/><path d="M2 9h20m-6 7h3"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/>',plus:'<path d="M12 4v16M4 12h16"/>',send:'<path d="m3 20 18-8L3 4l3 8-3 8Zm3-8h15"/>',search:'<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',back:'<path d="m15 18-6-6 6-6"/>',moon:'<path d="M20 15A8 8 0 0 1 9 4 8 8 0 1 0 20 15Z"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m14 0h2M5 5l14 14M19 5 5 19"/>'};
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.chat}</svg>`;
    };
    const nav=[['chats','Чаты','chat'],['prides','Прайды','pride'],['contacts','Люди','users'],['gifts','Дары','gift'],['wallet','Кошелёк','wallet'],['settings','Настройки','settings']];
    let user=null, profile=null, chats=[], messages=[], attachments=[], prides=[], prideMemberships=[], prideChannels=[], channelMessages=[], wallet=null, subscription=null, active=null, activePride=null, activeChannel=null;
    let section='chats', modal='', authMode='login', notice='', search='', lookup=null, busy=false, channel=null, refreshTimer=null;
    let theme=localStorage.getItem('pride-messenger-theme')==='light'?'light':'dark';
    let drafts={};const saveDrafts=()=>{try{if(user)localStorage.setItem('pride-messenger-drafts-'+user.id,JSON.stringify(drafts));}catch{}};
    const ok = response => { if(response.error) throw response.error; return response.data; };
    const inform = message => { notice=message; render(); };
    const setBusy = value => {busy=value; root.querySelectorAll('button[type="submit"]').forEach(b=>b.disabled=value);};
    function renderAuth() {
      document.documentElement.dataset.theme=theme;
      if(authMode==='recover'||authMode==='new-password'){
        root.innerHTML=`<main class="setup-screen"><div class="setup-art"></div><div class="setup-content auth-content"><div class="brand"><span class="brand-icon">P</span>Pride<span>Messenger</span></div><span class="eyebrow">ВАШ АККАУНТ</span><h1>${authMode==='recover'?'Вернём вас <em>на тропу.</em>':'Новый пароль — <em>новый старт.</em>'}</h1><div class="auth-card"><form id="${authMode==='recover'?'recover-form':'new-password-form'}">${authMode==='recover'?'<label>Электронная почта<input name="email" type="email" required autocomplete="email"></label>':'<label>Новый пароль<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>'}<button class="button primary" type="submit">${authMode==='recover'?'Отправить письмо':'Сменить пароль'}</button></form><button class="auth-link" data-live="auth-back">Вернуться ко входу</button>${notice?`<p class="auth-notice" role="status">${esc(notice)}</p>`:''}</div></div></main>`;
        return;
      }
      root.innerHTML=`<main class="setup-screen"><div class="setup-art"></div><div class="setup-content auth-content"><div class="brand"><span class="brand-icon">P</span>Pride<span>Messenger</span></div><span class="eyebrow">НОВАЯ ТРОПА ОБЩЕНИЯ</span><h1>Встречаемся под <em>одним солнцем.</em></h1><p>Личные беседы и прайды в отдельном защищённом пространстве Supabase.</p><div class="auth-card"><div class="auth-tabs"><button data-live="auth-mode" data-value="login" class="${authMode==='login'?'active':''}">Войти</button><button data-live="auth-mode" data-value="signup" class="${authMode==='signup'?'active':''}">Создать аккаунт</button></div><form id="auth-form">${authMode==='signup'?'<label>Имя пользователя<input name="username" pattern="[A-Za-z0-9_]{3,24}" maxlength="24" required autocomplete="username" placeholder="lion_heart"></label><label>Отображаемое имя<input name="display_name" maxlength="60" required placeholder="Ваше имя"></label>':''}<label>Электронная почта<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label><label>Пароль<input name="password" type="password" minlength="8" required autocomplete="${authMode==='login'?'current-password':'new-password'}" placeholder="Не менее 8 символов"></label><button class="button primary" type="submit">${authMode==='login'?'Войти':'Зарегистрироваться'}</button></form>${authMode==='login'?'<button class="auth-link" data-live="recover">Забыли пароль?</button>':''}${notice?`<p class="auth-notice" role="status">${esc(notice)}</p>`:''}</div><small>Открывая аккаунт, вы используете отдельный проект PrideMessenger. <a href="?demo=1">Посмотреть локальное демо</a></small></div></main>`;
    }
    function chatRows() {
      const list=chats.filter(c=>(c.kind==='group'?c.title:c.peer_name||'Собеседник').toLowerCase().includes(search.toLowerCase()));
      return `<div class="list-header"><div><span class="eyebrow">ВАША ТРОПА</span><h2>Сообщения</h2></div><button class="round-button" data-live="new-chat" aria-label="Новый чат">${svg('plus')}</button></div><label class="search-box">${svg('search',17)}<input id="chat-search" placeholder="Найти беседу" value="${esc(search)}" autocomplete="off"></label><div class="chat-list">${list.length?list.map(c=>{const name=c.kind==='group'?c.title:c.peer_name||'Собеседник';return `<button class="chat-row ${c.id===active?'selected':''}" data-live="open-chat" data-id="${esc(c.id)}"><span class="avatar">${esc(name[0]||'?')}</span><span class="chat-row-copy"><strong>${esc(name)}</strong><small>${esc(c.last_body||'Начните разговор')}</small></span><time>${clock(c.last_at)}</time></button>`}).join(''):'<div class="list-empty">Бесед пока нет. Найдите человека по имени пользователя.</div>'}</div><button class="list-create" data-live="new-chat">${svg('plus',17)} Новый диалог или группа</button>`;
    }
    function sidePanel() {
      const titles={prides:['Прайды','Сообщества по интересам'],contacts:['Люди','Поиск по имени пользователя'],gifts:['Дары саванны','Косметические предметы'],wallet:['Кошелёк','Pc и Claws'],settings:['Настройки','Ваше пространство']};
      const [title,sub]=titles[section]||['PrideMessenger',''];
      return `<div class="list-header"><div><span class="eyebrow">PRIDEMESSENGER</span><h2>${title}</h2></div></div><p class="panel-sub">${sub}</p><div class="side-art"><div class="side-sun"></div><span>За каждым горизонтом<br>новая история.</span></div><div class="side-note">Аккаунт: @${esc(profile?.username||'')}</div>`;
    }
    function chatContent() {
      const chat=chats.find(c=>c.id===active);
      if(!chat)return welcome();
      const name=chat.kind==='group'?chat.title:chat.peer_name||'Собеседник';
      return `<div class="conversation"><header class="chat-head"><button class="mobile-back" data-live="back" aria-label="К списку чатов">${svg('back')}</button><span class="avatar small">${esc(name[0]||'?')}</span><div class="chat-head-name"><strong>${esc(name)}</strong><small>${chat.kind==='group'?'Групповой чат':'Личный чат'} · защищённая переписка</small></div></header><div class="messages" id="messages"><div class="chat-day">Последние 50 сообщений</div>${messages.length?messages.map(m=>`<div class="bubble-row ${m.sender_id===user.id?'mine':''}"><div class="bubble"><div class="bubble-text">${esc(m.body).replace(/\n/g,'<br>')}</div>${attachments.filter(a=>a.message_id===m.id).map(a=>`<button class="attachment-chip" data-live="download" data-id="${esc(a.id)}">📎 ${esc(a.mime_type)} · ${Math.ceil(a.size_bytes/1024)} КБ</button>`).join('')}<div class="bubble-meta"><time>${clock(m.created_at)}${m.edited_at?' · изм.':''}</time>${m.sender_id===user.id?`<button data-live="edit-message" data-id="${esc(m.id)}" aria-label="Изменить сообщение">✎</button><button data-live="delete-message" data-id="${esc(m.id)}" aria-label="Удалить сообщение">×</button>`:''}</div></div></div>`).join(''):'<div class="empty-chat">Начните разговор. Ваше сообщение увидят только участники чата.</div>'}</div><form class="composer" id="composer"><label class="attach-picker" title="Прикрепить файл">📎<input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,audio/webm,video/webm" aria-label="Прикрепить файл"></label><textarea name="body" rows="1" maxlength="4000" placeholder="Сообщение для ${esc(name)}" aria-label="Текст сообщения">${esc(drafts[chat.id]||'')}</textarea><button class="send" type="submit" aria-label="Отправить">${svg('send')}</button></form><div class="composer-note">Enter — отправить · Shift+Enter — новая строка</div></div>`;
    }
    function welcome(){return `<div class="welcome"><span class="eyebrow">ВАША ТРОПА</span><h1>Один мир. Много историй.</h1><p>Выберите беседу или начните новую. Пишите людям по точному имени пользователя.</p><button class="button primary" data-live="new-chat">${svg('plus')} Начать беседу</button></div>`}
    function sectionContent() {
      if(section==='prides'){
        if(activePride){
          const pride=prides.find(p=>p.id===activePride);
          return `<div class="page-content pride-room"><button class="button subtle" data-live="back-prides">${svg('back')} Все прайды</button><span class="eyebrow">ТРОПЫ ПРАЙДА</span><h1>${esc(pride?.name||'Прайд')}</h1><p>${esc(pride?.description||'Место для новых историй.')}</p><div class="channel-tabs">${prideChannels.map(c=>`<button class="${c.id===activeChannel?'active':''}" data-live="open-channel" data-id="${esc(c.id)}"># ${esc(c.name)}</button>`).join('')}</div><div class="channel-feed" id="channel-feed">${channelMessages.length?channelMessages.map(m=>`<div class="channel-message"><span class="avatar small">${m.author_id===user.id?esc(profile.display_name?.[0]||'Я'):'•'}</span><div><strong>${m.author_id===user.id?'Вы':'Участник прайда'}</strong><time>${clock(m.created_at)}</time><p>${esc(m.body).replace(/\n/g,'<br>')}</p></div></div>`).join(''):'<p class="channel-empty">Здесь пока тихо. Начните разговор в этой тропе.</p>'}</div><form id="channel-composer" class="channel-composer"><textarea name="body" maxlength="4000" required placeholder="Сообщение в тропу" aria-label="Сообщение в канал">${esc(drafts[activeChannel]||'')}</textarea><button class="button primary" type="submit">${svg('send')} Отправить</button></form></div>`;
        }
        return `<div class="page-content"><span class="eyebrow">СООБЩЕСТВА</span><h1>Найдите свой прайд.</h1><p>Прайд — сообщество по интересам. Войдите и общайтесь в его текстовых тропах.</p><button class="button primary" data-live="new-pride">${svg('plus')} Создать прайд</button><div class="cards">${prides.map(p=>`<article class="pride-card"><div class="card-art"><span>✦</span></div><h3>${esc(p.name)}</h3><p>${esc(p.description||'Место для новых историй.')}</p><small>${prideMemberships.includes(p.id)?'Вы участник':'Открытый прайд'}</small><button data-live="${prideMemberships.includes(p.id)?'open-pride':'join-pride'}" data-id="${esc(p.id)}">${prideMemberships.includes(p.id)?'Открыть тропы':'Присоединиться'}</button></article>`).join('')||'<p>Пока нет открытых прайдов. Создайте первый.</p>'}</div></div>`;
      }
      if(section==='contacts')return `<div class="page-content"><span class="eyebrow">ЛЮДИ</span><h1>Найдите своих.</h1><p>Введите точное имя пользователя. Результаты поиска ограничены для защиты от перебора.</p><form id="find-form" class="inline-search"><input name="username" pattern="[A-Za-z0-9_]{3,24}" required placeholder="Имя пользователя"><button class="button primary" type="submit">${svg('search')} Найти</button></form>${lookup?`<div class="contact-result"><span class="avatar">${esc(lookup.display_name?.[0]||'?')}</span><div><strong>${esc(lookup.display_name)}</strong><small>@${esc(lookup.username)}</small></div><button class="button primary" data-live="start-dm" data-id="${esc(lookup.id)}">Написать</button></div>`:''}</div>`;
      if(section==='wallet')return `<div class="page-content"><span class="eyebrow">ВАША ЭКОНОМИКА</span><h1>Свобода выбора.</h1><p>Pc находятся в PrideCoin. Claws 彡 — баллы для косметики, их нельзя вывести.</p><div class="wallet-banner"><div><small>КОШЕЛЁК PRIDECOIN</small><h2>Откройте свой кошелёк</h2><p>Текущий баланс Pc и пополнение доступны в PrideCoin.</p><a class="button primary" target="_blank" rel="noopener noreferrer" href="${walletUrl}">${svg('wallet')} Открыть кошелёк Pc</a></div><span class="wallet-orb">P</span></div><div class="section-head"><h2>Логово привилегий</h2><span>ПОДПИСКИ ЗА PC</span></div><p>Ваш план: <strong>${esc(subscription?.plan||'savanna')}</strong> · Claws: <strong>${Number(wallet?.balance||0)}</strong> 彡</p><div class="plans">${[['Savanna','0','Базовое общение'],['Cheetah','149','Оформление гепарда · 75 Claws/мес.'],['Leopard','349','Янтарная тема · 200 Claws/мес.'],['Lion','699','Золотой стиль · 450 Claws/мес.']].map(([name,price,desc])=>`<div class="plan"><strong>${name}</strong><div><b>${price}</b> Pc <small>/ месяц</small></div><p>${desc}</p>${price==='0'?'<span class="plan-current">Базовый уровень</span>':'<button disabled title="Ожидает подтверждаемую интеграцию PrideCoin">Покупка пока недоступна</button>'}</div>`).join('')}</div><p class="honest">Переход в кошелёк не оплачивает подписку. Покупки станут доступны после защищённого подтверждения списания Pc.</p></div>`;
      if(section==='gifts')return `<div class="page-content"><span class="eyebrow">ДАРЫ САВАННЫ</span><h1>Знаки внимания.</h1><p>Каталог готовится. Покупки и дарение будут доступны после запуска защищённой экономики.</p><div class="gift-grid">${[['✧','Перо Фули'],['◈','Золотая грива'],['♧','Лунная акация'],['✦','Звёздный водопой']].map(([symbol,name])=>`<div class="gift-card"><span>${symbol}</span><strong>${name}</strong><small>Скоро в каталоге</small></div>`).join('')}</div></div>`;
      if(section==='settings')return `<div class="page-content"><span class="eyebrow">НАСТРОЙКИ</span><h1>Ваша саванна.</h1><p>@${esc(profile?.username)} · ${esc(user?.email)}</p><div class="setting-panel"><div><h3>Профиль</h3><p>Изменения видны вашим собеседникам.</p></div><form id="profile-form"><input name="display_name" maxlength="60" required value="${esc(profile?.display_name)}" aria-label="Отображаемое имя"><input name="bio" maxlength="500" value="${esc(profile?.bio)}" placeholder="О себе" aria-label="О себе"><button class="button primary">Сохранить</button></form></div><div class="setting-panel"><div><h3>Пароль</h3><p>Обновите пароль вашего аккаунта.</p></div><form id="change-password-form"><input name="password" type="password" minlength="8" required autocomplete="new-password" placeholder="Новый пароль" aria-label="Новый пароль"><button class="button primary" type="submit">Сменить пароль</button></form></div><div class="setting-panel"><div><h3>Тема интерфейса</h3><p>Рассвет саванны или Ночная охота.</p></div><button class="button subtle" data-live="theme">${svg(theme==='light'?'moon':'sun')} ${theme==='light'?'Ночная охота':'Рассвет саванны'}</button></div><div class="setting-panel"><div><h3>Аккаунт</h3><p>Выйти на этом устройстве.</p></div><button class="button danger" data-live="logout">Выйти</button></div></div>`;
      return '';
    }
    function modalMarkup(){
      if(!modal)return '';
      if(modal==='chat')return `<div class="modal-backdrop" data-live="close-modal"><div class="dialog" role="dialog" aria-modal="true" aria-label="Новая беседа"><button class="dialog-close" data-live="close-modal" aria-label="Закрыть">×</button><span class="eyebrow">НОВАЯ ИСТОРИЯ</span><h2>Новая беседа</h2><p>Для личного чата введите одно имя пользователя. Для группы — название и имена участников через запятую.</p><form id="chat-form"><label>Тип беседы<select name="kind"><option value="dm">Личный чат</option><option value="group">Группа</option></select></label><label>Имя пользователя или участники<input name="usernames" required placeholder="lion_heart или lion_heart, cheetah"></label><label>Название группы<input name="title" maxlength="80" placeholder="Только для группы"></label><button class="button primary" type="submit">Создать</button></form></div></div>`;
      return `<div class="modal-backdrop" data-live="close-modal"><div class="dialog" role="dialog" aria-modal="true" aria-label="Создать прайд"><button class="dialog-close" data-live="close-modal" aria-label="Закрыть">×</button><span class="eyebrow">НОВАЯ ИСТОРИЯ</span><h2>Создать прайд</h2><form id="pride-form"><label>Название<input name="name" minlength="2" maxlength="80" required></label><label>Описание<textarea name="description" maxlength="1000"></textarea></label><button class="button primary" type="submit">Создать</button></form></div></div>`;
    }
    function render() {
      if(!user||!profile||authMode==='new-password'){renderAuth();return;}
      document.documentElement.dataset.theme=theme;
      const hasChat=section==='chats'&&active;
      root.innerHTML=`<div class="shell ${hasChat?'has-chat':''}"><aside class="rail"><div class="rail-logo">P</div><nav aria-label="Разделы">${nav.map(([id,label,ico])=>`<button class="rail-item ${section===id?'active':''}" data-live="section" data-id="${id}" title="${label}" aria-label="${label}">${svg(ico)}<span>${label}</span></button>`).join('')}</nav><div class="rail-bottom"><button class="rail-item" data-live="theme" aria-label="Сменить тему">${svg(theme==='light'?'moon':'sun')}</button><span class="avatar me">${esc(profile.display_name?.[0]||'Я')}</span></div></aside><aside class="list-panel"><div class="list-top"><div class="wordmark"><span class="brand-icon">P</span><span>Pride<b>Messenger</b></span></div><span class="demo-pill">SUPABASE</span></div>${section==='chats'?chatRows():sidePanel()}</aside><main class="content">${section==='chats'?chatContent():sectionContent()}</main><nav class="mobile-nav" aria-label="Мобильная навигация">${nav.filter(x=>x[0]!=='gifts').map(([id,label,ico])=>`<button class="${section===id?'active':''}" data-live="section" data-id="${id}">${svg(ico,19)}<span>${label}</span></button>`).join('')}</nav></div>${notice?`<div class="live-toast" role="status"><span>${esc(notice)}</span><button data-live="dismiss" aria-label="Закрыть">×</button></div>`:''}${modalMarkup()}`;
      const area=root.querySelector('#messages');if(area)area.scrollTop=area.scrollHeight;
    }
    async function loadConversations(){chats=ok(await db.rpc('pm_list_conversations'))||[];if(active&&!chats.some(c=>c.id===active)){active=null;messages=[];}render();}
    async function loadMessages(){if(!active)return;const id=active;const rows=ok(await db.from('pm_messages').select('id,conversation_id,sender_id,body,created_at,edited_at').eq('conversation_id',id).order('created_at',{ascending:false}).limit(50));if(active!==id)return;messages=(rows||[]).reverse();attachments=messages.length?ok(await db.from('pm_attachments').select('id,message_id,object_path,mime_type,size_bytes').in('message_id',messages.map(m=>m.id))):[];render();await db.rpc('pm_mark_read',{p_conversation_id:id});}
    function watchActive(){if(channel){db.removeChannel(channel);channel=null;}
      if(section==='prides'&&activeChannel){channel=db.channel('pride-channel-'+activeChannel).on('postgres_changes',{event:'*',schema:'public',table:'pm_channel_messages',filter:'channel_id=eq.'+activeChannel},()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>loadChannelMessages().catch(e=>inform(sayError(e))),180)}).subscribe();return;}
      if(section!=='chats'||!active)return;
      channel=db.channel('chat-'+active).on('postgres_changes',{event:'*',schema:'public',table:'pm_messages',filter:'conversation_id=eq.'+active},()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(async()=>{try{await loadMessages();await loadConversations();}catch(e){inform(sayError(e));}},180)}).subscribe();}
    async function openChat(id){active=id;section='chats';messages=[];render();watchActive();await loadMessages();}
    async function loadChannelMessages(){if(!activeChannel)return;const id=activeChannel;const rows=ok(await db.from('pm_channel_messages').select('id,channel_id,author_id,body,created_at').eq('channel_id',id).order('created_at',{ascending:false}).limit(50));if(activeChannel!==id)return;channelMessages=(rows||[]).reverse();render();}
    async function openPride(id){activePride=id;section='prides';prideChannels=ok(await db.from('pm_channels').select('id,name,kind').eq('pride_id',id).order('name'))||[];activeChannel=prideChannels[0]?.id||null;channelMessages=[];render();watchActive();await loadChannelMessages();}
    async function refresh(){const id=user.id;const results=await Promise.all([db.from('pm_profiles').select('id,username,display_name,bio').eq('id',id).single(),db.rpc('pm_list_conversations'),db.from('pm_prides').select('id,name,description,owner_id').eq('visibility','public').order('created_at',{ascending:false}).limit(30),db.from('pm_claws_wallets').select('balance').eq('user_id',id).single(),db.from('pm_subscriptions').select('plan,expires_at').eq('user_id',id).single(),db.from('pm_pride_members').select('pride_id').eq('user_id',id)]);profile=ok(results[0]);chats=ok(results[1])||[];prides=ok(results[2])||[];wallet=ok(results[3]);subscription=ok(results[4]);prideMemberships=(ok(results[5])||[]).map(x=>x.pride_id);render();}
    let booting=false;
    async function boot(){if(booting)return;booting=true;try{const {data,error}=await db.auth.getUser();if(error||!data.user){user=null;profile=null;active=null;if(channel){db.removeChannel(channel);channel=null;}renderAuth();return;}const changed=user?.id!==data.user.id;user=data.user;if(changed){active=null;messages=[];try{drafts=JSON.parse(localStorage.getItem('pride-messenger-drafts-'+user.id)||'{}')}catch{drafts={}};}await refresh();}catch(e){notice=sayError(e);render();}finally{booting=false;}}
    db.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY'){authMode='new-password';notice='Введите новый пароль для аккаунта.';renderAuth();}else if(event==='SIGNED_IN'||event==='SIGNED_OUT')setTimeout(boot,0);});
    root.addEventListener('click',async e=>{
      const button=e.target.closest('[data-live]');if(!button)return;
      const action=button.dataset.live,id=button.dataset.id;
      try{
        if(action==='auth-mode'){authMode=button.dataset.value;notice='';renderAuth();}
        else if(action==='recover'){authMode='recover';notice='';renderAuth();}
        else if(action==='auth-back'){authMode='login';notice='';renderAuth();}
        else if(action==='section'){section=id;notice='';watchActive();render();}
        else if(action==='open-chat')await openChat(id);
        else if(action==='back'){active=null;messages=[];watchActive();render();}
        else if(action==='new-chat'||action==='new-pride'){modal=action==='new-chat'?'chat':'pride';render();}
        else if(action==='close-modal'){if(e.target===button||button.classList.contains('dialog-close')){modal='';render();}}
        else if(action==='theme'){theme=theme==='light'?'dark':'light';localStorage.setItem('pride-messenger-theme',theme);render();}
        else if(action==='dismiss'){notice='';render();}
        else if(action==='logout'){ok(await db.auth.signOut({scope:'local'}));user=null;profile=null;notice='Вы вышли из аккаунта.';renderAuth();}
        else if(action==='start-dm'){const chatId=ok(await db.rpc('pm_start_dm',{p_other_user_id:id}));await loadConversations();await openChat(chatId);}
        else if(action==='join-pride'){ok(await db.rpc('pm_join_pride',{p_pride_id:id}));prideMemberships.push(id);await openPride(id);inform('Вы присоединились к прайду.');}
        else if(action==='open-pride')await openPride(id);
        else if(action==='back-prides'){activePride=null;activeChannel=null;channelMessages=[];watchActive();render();}
        else if(action==='open-channel'){activeChannel=id;channelMessages=[];render();watchActive();await loadChannelMessages();}
        else if(action==='download'){const attachment=attachments.find(x=>x.id===id);if(!attachment)return;const blob=ok(await db.storage.from('pm-attachments').download(attachment.object_path));const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='pride-attachment.'+attachment.object_path.split('.').pop();document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
        else if(action==='edit-message'){const m=messages.find(x=>x.id===id);if(!m||m.sender_id!==user.id)return;const body=prompt('Изменить сообщение',m.body);if(body===null)return;ok(await db.rpc('pm_edit_message',{p_message_id:id,p_body:body}));await loadMessages();await loadConversations();}
        else if(action==='delete-message'){const m=messages.find(x=>x.id===id);if(!m||m.sender_id!==user.id||!confirm('Удалить сообщение и вложения?'))return;for(const file of attachments.filter(a=>a.message_id===id)){ok(await db.storage.from('pm-attachments').remove([file.object_path]));ok(await db.rpc('pm_unlink_attachment',{p_attachment_id:file.id}));}ok(await db.rpc('pm_delete_message',{p_message_id:id}));await loadMessages();await loadConversations();}
      }catch(error){inform(sayError(error));}
    });
    root.addEventListener('input',e=>{if(e.target.matches('#composer textarea')&&active){drafts[active]=e.target.value;saveDrafts();e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,8*24)+'px';}else if(e.target.matches('#channel-composer textarea')&&activeChannel){drafts[activeChannel]=e.target.value;saveDrafts();}else if(e.target.id==='chat-search'){search=e.target.value;const list=root.querySelector('.chat-list');if(list){const name=search.toLowerCase();list.querySelectorAll('.chat-row').forEach(row=>{row.hidden=!row.querySelector('strong')?.textContent.toLowerCase().includes(name);});}}});
    root.addEventListener('keydown',e=>{if(e.target.matches('#composer textarea')&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.target.form.requestSubmit();}});
    root.addEventListener('submit',async e=>{
      e.preventDefault();if(busy)return;
      const form=e.target,values=new FormData(form);setBusy(true);
      try{
        if(form.id==='recover-form'){
          ok(await db.auth.resetPasswordForEmail(String(values.get('email')||'').trim(),{redirectTo:location.origin+location.pathname}));notice='Если аккаунт существует, письмо для восстановления отправлено.';renderAuth();
        }else if(form.id==='new-password-form'){
          ok(await db.auth.updateUser({password:String(values.get('password')||'')}));authMode='login';notice='Пароль изменён.';await boot();inform('Пароль изменён.');
        }else if(form.id==='change-password-form'){
          ok(await db.auth.updateUser({password:String(values.get('password')||'')}));form.reset();inform('Пароль изменён.');
        }else if(form.id==='auth-form'){
          const email=String(values.get('email')).trim(),password=String(values.get('password'));
          if(authMode==='signup'){
            const username=String(values.get('username')).trim(),display_name=String(values.get('display_name')).trim();
            if(!/^[A-Za-z0-9_]{3,24}$/.test(username)||!display_name)throw new Error('Проверьте имя пользователя и отображаемое имя.');
            const {data,error}=await db.auth.signUp({email,password,options:{data:{username,display_name},emailRedirectTo:location.origin+location.pathname}});
            if(error)throw error;
            if(data.session){await boot();}else{authMode='login';notice='Проверьте почту и подтвердите адрес, затем войдите.';renderAuth();}
          }else{const {error}=await db.auth.signInWithPassword({email,password});if(error)throw error;await boot();}
        }else if(form.id==='composer'){
          const body=String(values.get('body')||'').trim(),file=values.get('file');if(!active)return;
          const clientId=crypto.randomUUID();
          if(file&&file.size){
            const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','application/pdf':'pdf','text/plain':'txt','audio/webm':'webm','video/webm':'webm'};
            if(!extensions[file.type]||file.size>10485760)throw new Error('Допустимы изображения, PDF, текст, WebM до 10 МБ.');
            const path=active+'/'+user.id+'/'+crypto.randomUUID()+'.'+extensions[file.type];
            ok(await db.storage.from('pm-attachments').upload(path,file,{contentType:file.type,upsert:false}));
            try{ok(await db.rpc('pm_send_attachment',{p_conversation_id:active,p_body:(body||'📎 '+file.name).slice(0,4000),p_client_id:clientId,p_object_path:path}));}
            catch(error){await db.storage.from('pm-attachments').remove([path]);throw error;}
          }else{if(!body)return;ok(await db.rpc('pm_send_message',{p_conversation_id:active,p_body:body,p_client_id:clientId}));}
          drafts[active]='';saveDrafts();form.reset();await loadMessages();await loadConversations();
        }else if(form.id==='channel-composer'){
          const body=String(values.get('body')||'').trim();if(!body||!activeChannel)return;ok(await db.rpc('pm_send_channel_message',{p_channel_id:activeChannel,p_body:body,p_client_id:crypto.randomUUID()}));drafts[activeChannel]='';saveDrafts();form.reset();await loadChannelMessages();
        }else if(form.id==='find-form'){
          const username=String(values.get('username')||'').trim();const matches=ok(await db.rpc('pm_find_person',{p_username:username}));lookup=matches?.[0]||null;inform(lookup?'Человек найден.':'Пользователь не найден.');
        }else if(form.id==='chat-form'){
          const kind=values.get('kind'),names=String(values.get('usernames')||'').split(',').map(x=>x.trim()).filter(Boolean);
          if((kind==='dm'&&names.length!==1)||!names.length||names.length>20||names.some(x=>!/^[A-Za-z0-9_]{3,24}$/.test(x)))throw new Error('Введите корректные имена пользователей.');
          const peers=[];for(const name of [...new Set(names)]){const result=ok(await db.rpc('pm_find_person',{p_username:name}));if(!result?.[0])throw new Error('Не найден пользователь @'+name);if(result[0].id!==user.id)peers.push(result[0].id);}
          let chatId;if(kind==='dm'){if(peers.length!==1)throw new Error('Для личного чата выберите другого пользователя.');chatId=ok(await db.rpc('pm_start_dm',{p_other_user_id:peers[0]}));}else{const title=String(values.get('title')||'').trim();if(title.length<2)throw new Error('Укажите название группы.');chatId=ok(await db.rpc('pm_create_group',{p_title:title,p_members:peers}));}
          modal='';await loadConversations();await openChat(chatId);
        }else if(form.id==='pride-form'){
          const prideId=ok(await db.rpc('pm_create_pride',{p_name:String(values.get('name')||''),p_description:String(values.get('description')||'')}));modal='';prides=ok(await db.from('pm_prides').select('id,name,description,owner_id').eq('visibility','public').order('created_at',{ascending:false}).limit(30))||[];prideMemberships.push(prideId);await openPride(prideId);inform('Прайд создан.');
        }else if(form.id==='profile-form'){
          const display_name=String(values.get('display_name')||'').trim(),bio=String(values.get('bio')||'').trim();profile=ok(await db.from('pm_profiles').update({display_name,bio}).eq('id',user.id).select('id,username,display_name,bio').single());inform('Профиль сохранён.');
        }
      }catch(error){inform(sayError(error));}finally{setBusy(false);}
    });
    await boot();
    if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
  };
})();
