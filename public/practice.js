/* ВетАтлас: три учебных формата. Активная попытка хранится только в памяти вкладки. */
'use strict';
const PRACTICE_MODES = [
  {id:'sequence',title:'Соберите маршрут',short:'Порядок действий',icon:'layers',description:'Выберите карточки в порядке клинического рассуждения. После проверки разберите каждое решение.'},
  {id:'matching',title:'Найдите пары',short:'Связи и понятия',icon:'cells',description:'Свяжите понятия с их значением. Выбирайте карточку слева, затем подходящую справа.'},
  {id:'case',title:'Клинический случай',short:'Разбор пациента',icon:'book',description:'Изучите историю пациента и последовательно ответьте на три вопроса с объяснениями.'}
];
let practiceAttempt = null;
function practiceIdentity(){return String(window.VetAccount?.user?.id || 'guest');}
function practiceExercise(id){return (Array.isArray(window.EXERCISES)?window.EXERCISES:[]).find(x=>x.id===id);}
function practiceActivities(){return Array.isArray(student.activities)?student.activities:[];}
function practiceMode(id){return PRACTICE_MODES.find(m=>m.id===id);}
function practicePath(id,mode){return `#/practice/${encodeURIComponent(id)}${mode?'?mode='+mode:''}`;}
function practiceUniqueId(){return window.crypto?.randomUUID?.() || `practice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,11)}`;}
function practiceOrder(values){const result=shuffle(values);if(result.length>1&&result.every((x,i)=>x===values[i]))result.push(result.shift());return result;}
function practiceBegin(topic,mode){
 const exercise=practiceExercise(topic);if(!exercise||!practiceMode(mode))return null;
 const attempt={id:practiceUniqueId(),identity:practiceIdentity(),topic,mode,recorded:false,done:false,feedback:'',correct:0};
 if(mode==='sequence'){attempt.available=practiceOrder(exercise.sequence.cards.map(c=>c.id));attempt.selected=[];}
 if(mode==='matching'){attempt.leftOrder=practiceOrder(exercise.matching.pairs.map((_,i)=>i));attempt.rightOrder=practiceOrder(exercise.matching.pairs.map((_,i)=>i));attempt.selectedLeft=null;attempt.matched=[];attempt.missed=[];attempt.mistakes=0;attempt.wrongRight=null;}
 if(mode==='case'){attempt.position=0;attempt.selected=null;attempt.checked=false;attempt.answers=[];}
 practiceAttempt=attempt;return attempt;
}
function practiceRecord(attempt,correct,total){
 if(attempt.recorded||attempt.identity!==practiceIdentity())return;
 attempt.recorded=true;attempt.correct=correct;attempt.done=true;
 student.activities=[{id:attempt.id,topic:attempt.topic,mode:attempt.mode,correct,total,date:new Date().toISOString()},...practiceActivities()].slice(0,200);
 persist();
}
function practiceCompleted(topic,mode){return practiceActivities().some(a=>a.topic===topic&&a.mode===mode);}
function practiceModeCards(d,compact=false){return `<div class="practice-mode-grid${compact?' compact':''}">${PRACTICE_MODES.map(m=>`<a class="practice-mode-card" href="${practicePath(d.id,m.id)}"><span class="practice-mode-icon">${icon(m.icon)}</span><div><small>${esc(m.short)}${practiceCompleted(d.id,m.id)?' · выполнено':''}</small><h3>${esc(m.title)}</h3>${compact?'':`<p>${esc(m.description)}</p>`}</div><span class="practice-card-arrow" aria-hidden="true">↗</span></a>`).join('')}</div>`;}
function renderPracticeLinks(d){
 if(!practiceExercise(d.id))return '';
 return `<section class="article-practice" id="article-practice" aria-labelledby="article-practice-title"><span class="eyebrow">Закрепление знаний</span><h2 id="article-practice-title">Попробуйте применить материал</h2><p>Три коротких задания: восстановите маршрут, найдите связи и разберите клиническую ситуацию.</p>${practiceModeCards(d,true)}</section>`;
}
function renderPractice(){
 const ready=DISEASES.filter(d=>practiceExercise(d.id));
 const completed=new Set(practiceActivities().filter(a=>ready.some(d=>d.id===a.topic)&&practiceMode(a.mode)).map(a=>a.topic+':'+a.mode)).size;
 main.innerHTML=pageTop('Практика и учебные игры','Тренируйте клиническое мышление: восстанавливайте порядок решений, связывайте понятия и разбирайте ситуации из практики.',[{name:'Практика'}],'ОТ ЗНАНИЯ К РЕШЕНИЮ')+`<div class="container practice-page"><div class="practice-summary"><div><strong>${ready.length*3}</strong><span>заданий по ${ready.length} темам</span></div><div><strong>${completed}</strong><span>форматов уже выполнено</span></div><p>Результат сохраняется после завершения задания. Во время игры можно ошибаться и пробовать снова.</p></div><div class="practice-hub-toolbar"><label class="search-field">${icon('search')}<input type="search" id="practice-search" aria-label="Поиск темы для практики" placeholder="Найдите заболевание…"></label><span id="practice-topic-count" role="status">Тем: ${ready.length}</span></div><div class="practice-topic-grid" id="practice-topic-grid">${ready.map(d=>practiceTopicCard(d)).join('')}</div><p class="practice-learning-note">Задания показывают логику рассуждения. Исследования и лечение выбирает ветеринарный врач; у конкретного пациента этапы могут идти параллельно или меняться по срочности.</p></div>`;
}
function practiceTopicCard(d){return `<article class="practice-topic-card" data-practice-topic="${esc(d.id)}" data-practice-search="${esc((d.title+' '+category(d.category).name).toLocaleLowerCase('ru'))}"><span class="tag ${esc(d.category)}">${esc(category(d.category).short)}</span><h2><a href="${practicePath(d.id)}">${esc(d.title)}</a></h2><div class="practice-topic-links">${PRACTICE_MODES.map(m=>`<a href="${practicePath(d.id,m.id)}">${icon(m.icon)}<span>${esc(m.title)}</span>${practiceCompleted(d.id,m.id)?'<span class="practice-done-mark" aria-label="Выполнено">✓</span>':'<span aria-hidden="true">↗</span>'}</a>`).join('')}</div></article>`;}
function renderTopicPractice(id,params){
 const disease=getDisease(id),exercise=practiceExercise(id),mode=practiceMode(params?.get?.('mode'));
 if(!disease||!exercise){main.innerHTML=pageTop('Задание не найдено','Откройте каталог практики и выберите доступную тему.',[{name:'Практика',href:'#/practice'}])+`<div class="container practice-page">${button('Все задания','#/practice')}</div>`;return;}
 if(!mode){
  main.innerHTML=pageTop(disease.title,'Выберите формат. Можно начать с любого задания и вернуться к материалу, когда потребуется.',[{name:'Практика',href:'#/practice'},{name:disease.title}],'ПРАКТИКА ПО ТЕМЕ')+`<div class="container practice-page">${practiceModeCards(disease)}<div class="practice-topic-bottom"><a class="text-link" href="#/disease/${esc(disease.id)}">${icon('book')}Вернуться к учебному материалу</a><p>Активная попытка доступна до обновления страницы. Завершённые результаты сохраняются в вашем прогрессе.</p></div></div>`;return;
 }
 if(!practiceAttempt||practiceAttempt.topic!==id||practiceAttempt.mode!==mode.id||practiceAttempt.identity!==practiceIdentity())practiceBegin(id,mode.id);
 main.innerHTML=pageTop(disease.title,mode.description,[{name:'Практика',href:'#/practice'},{name:disease.title,href:practicePath(id)},{name:mode.title}],'ПРАКТИКА ПО ТЕМЕ')+`<div class="container practice-page"><nav class="practice-tabs" aria-label="Форматы задания">${PRACTICE_MODES.map(m=>`<a href="${practicePath(id,m.id)}"${m.id===mode.id?' class="active" aria-current="page"':''}>${icon(m.icon)}${esc(m.title)}</a>`).join('')}</nav><div id="practice-game"></div><div class="practice-topic-bottom"><a class="text-link" href="#/disease/${esc(id)}?diagnostics=1">${icon('book')}Вернуться к разбору темы</a><p>До завершения задания попытка хранится в памяти вкладки. Обновление страницы начнёт её заново.</p></div></div>`;
 practicePaint();
}
function practiceActionButton(action,text,extra='',classes='button'){return `<button type="button" class="${classes}" data-practice-action="${action}" data-practice-attempt="${esc(practiceAttempt.id)}" ${extra}>${text}</button>`;}
function practicePaint(focusSelector){
 const holder=document.getElementById('practice-game');if(!holder||!practiceAttempt)return;
 const exercise=practiceExercise(practiceAttempt.topic);if(!exercise)return;
 holder.innerHTML=practiceAttempt.mode==='sequence'?practiceSequence(exercise):practiceAttempt.mode==='matching'?practiceMatching(exercise):practiceCase(exercise);
 if(focusSelector){const target=holder.querySelector(focusSelector);if(target&&/^H[1-6]$/.test(target.tagName))target.tabIndex=-1;target?.focus({preventScroll:true});}
}
function practiceResultHeading(attempt,total,label){const percent=Math.round(attempt.correct/total*100);return `<div class="practice-result-heading" tabindex="-1"><span class="practice-score" aria-label="${attempt.correct} из ${total}">${attempt.correct}<small>/ ${total}</small></span><div><span class="eyebrow">Задание завершено · ${percent}%</span><h2>${esc(label)}</h2><p>${attempt.correct===total?'Все решения верны. Теперь сравните их с объяснениями.':'Разберите объяснения и попробуйте ещё раз — ошибки помогают заметить важные различия.'}</p></div></div>`;}
function practiceFinishActions(){return `<div class="practice-finish-actions">${practiceActionButton('retry','Попробовать ещё раз')}<a class="button secondary" href="${practicePath(practiceAttempt.topic)}">Другие форматы</a><a class="text-link" href="#/progress">Посмотреть прогресс ${icon('arrow')}</a></div>`;}
function practiceSequence(exercise){
 const a=practiceAttempt,s=exercise.sequence,cards=s.cards,byId=id=>cards.find(c=>c.id===id);
 if(a.done)return `<section class="practice-panel">${practiceResultHeading(a,cards.length,'Правильный маршрут и разбор')}<p class="practice-instruction">${esc(s.instruction)}</p><ol class="practice-review-list">${cards.map((c,i)=>`<li class="${a.selected[i]===c.id?'correct':'needs-review'}"><span class="practice-review-number">${i+1}</span><div><small>${a.selected[i]===c.id?'На своём месте':`В вашей попытке: позиция ${a.selected.indexOf(c.id)+1}`}</small><h3>${esc(c.title)}</h3><p>${esc(c.explanation)}</p></div></li>`).join('')}</ol><p class="practice-result-note">Оценка показывает число карточек на верной позиции. Это учебная последовательность: реальные исследования врач может объединять и менять по состоянию пациента.</p>${practiceFinishActions()}</section>`;
 return `<section class="practice-panel"><div class="practice-game-heading"><div><span class="eyebrow">Порядок решений</span><h2>${esc(s.title)}</h2></div><span class="practice-counter">Выбрано ${a.selected.length} из ${cards.length}</span></div><p class="practice-instruction">${esc(s.instruction)}</p><p class="practice-help">Выбирайте карточки в нужном порядке. Чтобы изменить решение, уберите карточку из маршрута и выберите её снова.</p><div class="practice-sequence-layout"><div><h3 class="practice-column-title">Доступные карточки</h3><div class="practice-card-pool">${a.available.filter(id=>!a.selected.includes(id)).map(id=>{const c=byId(id);return practiceActionButton('sequence-pick',`<span>${esc(c.title)}</span><span aria-hidden="true">＋</span>`,`data-card="${esc(id)}"`,'practice-sequence-card');}).join('')||'<p class="practice-pool-empty">Все карточки в маршруте. Проверьте порядок перед завершением.</p>'}</div></div><div><h3 class="practice-column-title">Ваш маршрут</h3><ol class="practice-chosen-list">${a.selected.map((id,i)=>`<li><span class="practice-chosen-number">${i+1}</span><span>${esc(byId(id).title)}</span>${practiceActionButton('sequence-remove','×',`data-card="${esc(id)}" aria-label="Убрать из маршрута: ${esc(byId(id).title)}"`,'practice-remove')}</li>`).join('')||'<li class="practice-route-placeholder">Здесь появится выбранный вами порядок</li>'}</ol></div></div><div class="practice-game-actions">${practiceActionButton('sequence-check','Проверить маршрут',a.selected.length!==cards.length?'disabled':'')}<span class="practice-feedback" role="status" aria-live="polite">${esc(a.feedback)}</span></div></section>`;
}
function practiceMatching(exercise){
 const a=practiceAttempt,m=exercise.matching,pairs=m.pairs;
 if(a.done)return `<section class="practice-panel">${practiceResultHeading(a,pairs.length,'Все пары найдены')}<p class="practice-result-note">Сопоставлено: ${pairs.length} из ${pairs.length}. Без ошибочного выбора: ${a.correct} из ${pairs.length}. Ошибочных выборов: ${a.mistakes}. В прогресс записывается число пар, найденных без ошибки.</p><div class="practice-matching-review">${pairs.map(p=>`<div><h3>${esc(p.left)}</h3><strong>${esc(p.right)}</strong><p>${esc(p.explanation)}</p></div>`).join('')}</div>${practiceFinishActions()}</section>`;
 const side=(name,order)=>`<div class="practice-match-column"><h3 class="practice-column-title">${name==='left'?'Понятие или метод':'Подходящая связь'}</h3>${order.map(i=>{const matched=a.matched.includes(i),selected=name==='left'&&a.selectedLeft===i,wrong=name==='right'&&a.wrongRight===i;return practiceActionButton('match-'+name,`<span>${esc(pairs[i][name])}</span>${matched?'<span aria-hidden="true">✓</span>':''}`,`data-pair="${i}" ${matched?'disabled':''}${name==='left'?` aria-pressed="${selected}"`:''}`,`practice-match-card${matched?' matched':''}${selected?' selected':''}${wrong?' incorrect':''}`);}).join('')}</div>`;
 return `<section class="practice-panel"><div class="practice-game-heading"><div><span class="eyebrow">Понятия и связи</span><h2>${esc(m.title)}</h2></div><span class="practice-counter">Пар: ${a.matched.length} из ${pairs.length}</span></div><p class="practice-instruction">${esc(m.instruction)}</p><div class="practice-match-status"><p>Сначала выберите карточку слева, затем найдите её пару справа.</p><span>Ошибочных выборов: ${a.mistakes}</span></div><div class="practice-matching-layout">${side('left',a.leftOrder)}${side('right',a.rightOrder)}</div><p class="practice-feedback${a.wrongRight!==null?' incorrect':''}" role="status" aria-live="polite">${esc(a.feedback||'Выберите понятие слева.')}</p></section>`;
}
function practiceCase(exercise){
 const a=practiceAttempt,c=exercise.case;
 const patient=`<aside class="practice-patient"><span class="eyebrow">Клиническая ситуация</span><h3>${esc(c.patient)}</h3><p>${esc(c.history)}</p><h4>При осмотре</h4><ul>${c.findings.map(f=>`<li>${esc(f)}</li>`).join('')}</ul></aside>`;
 if(a.done)return `<section class="practice-panel">${practiceResultHeading(a,c.questions.length,'Разбор клинического случая')}<h3>${esc(c.title)}</h3><div class="practice-case-layout">${patient}<div class="practice-case-review">${c.questions.map((q,i)=>{const answer=a.answers[i],correct=answer===q.answer;return `<article class="practice-case-answer ${correct?'correct':'needs-review'}"><small>Вопрос ${i+1} · ${correct?'Верно':'Стоит повторить'}</small><h3>${esc(q.question)}</h3><p>Ваш ответ: <strong>${esc(q.options[answer])}</strong></p>${correct?'':`<p>Верный ответ: <strong>${esc(q.options[q.answer])}</strong></p>`}<p>${esc(q.explanation)}</p></article>`;}).join('')}</div></div>${practiceFinishActions()}</section>`;
 const q=c.questions[a.position],correct=a.checked&&a.selected===q.answer;
 return `<section class="practice-panel"><div class="practice-game-heading"><div><span class="eyebrow">Разбор пациента</span><h2>${esc(c.title)}</h2></div><span class="practice-counter">Вопрос ${a.position+1} из ${c.questions.length}</span></div><div class="practice-case-layout">${patient}<div class="practice-case-question"><div class="practice-case-progress" aria-label="Вопрос ${a.position+1} из ${c.questions.length}">${c.questions.map((_,i)=>`<span class="${i<=a.position?'active':''}"></span>`).join('')}</div><h3 tabindex="-1" id="practice-case-question">${esc(q.question)}</h3><div class="practice-case-options" role="group" aria-labelledby="practice-case-question">${q.options.map((option,i)=>practiceActionButton('case-select',`<span class="practice-option-letter" aria-hidden="true">${'АБВГ'[i]}</span><span>${esc(option)}</span>`,`data-practice-answer="${i}" aria-pressed="${a.selected===i}" ${a.checked?'disabled':''}`,`practice-case-option${a.selected===i?' selected':''}${a.checked&&i===q.answer?' correct':''}${a.checked&&a.selected===i&&!correct?' incorrect':''}`)).join('')}</div>${a.checked?`<div class="practice-case-feedback ${correct?'correct':'incorrect'}" role="status" tabindex="-1"><strong>${correct?'Верно':'Разберём решение'}</strong>${correct?'':`<p>Верный ответ: ${esc(q.options[q.answer])}</p>`}<p>${esc(q.explanation)}</p></div>${practiceActionButton('case-next','Следующий вопрос '+icon('arrow'))}`:practiceActionButton('case-check',a.position===c.questions.length-1?'Проверить и завершить':'Проверить ответ',a.selected===null?'disabled':'')}</div></div></section>`;
}
function practiceHandleAction(button){
 const a=practiceAttempt;if(!a||button.dataset.practiceAttempt!==a.id||button.disabled)return;
 if(a.identity!==practiceIdentity()){const id=a.topic,mode=a.mode;practiceAttempt=null;renderTopicPractice(id,new URLSearchParams({mode}));toast('Аккаунт изменился. Задание начато заново.');return;}
 const action=button.dataset.practiceAction,e=practiceExercise(a.topic);if(!e)return;
 if(action==='retry'){practiceBegin(a.topic,a.mode);practicePaint('h2');return;}
 if(a.done)return;
 if(action==='sequence-pick'){
  const id=button.dataset.card;if(!e.sequence.cards.some(c=>c.id===id)||a.selected.includes(id))return;
  a.selected.push(id);a.feedback='Карточка добавлена в маршрут.';practicePaint(a.selected.length===e.sequence.cards.length?'[data-practice-action="sequence-check"]':'[data-practice-action="sequence-pick"]');
 }else if(action==='sequence-remove'){
  a.selected=a.selected.filter(id=>id!==button.dataset.card);a.feedback='Карточка возвращена в доступные.';practicePaint('[data-practice-action="sequence-pick"]');
 }else if(action==='sequence-check'){
  if(a.selected.length!==e.sequence.cards.length)return;
  const correct=e.sequence.cards.reduce((n,c,i)=>n+(c.id===a.selected[i]?1:0),0);practiceRecord(a,correct,e.sequence.cards.length);practicePaint('.practice-result-heading');
 }else if(action==='match-left'){
  const i=Number(button.dataset.pair);if(!Number.isInteger(i)||!e.matching.pairs[i]||a.matched.includes(i))return;
  a.selectedLeft=i;a.wrongRight=null;a.feedback='Теперь выберите подходящую карточку справа.';practicePaint('[data-practice-action="match-right"]:not(:disabled)');
 }else if(action==='match-right'){
  const i=Number(button.dataset.pair);if(!Number.isInteger(i)||!e.matching.pairs[i]||a.matched.includes(i))return;
  if(a.selectedLeft===null){a.feedback='Сначала выберите карточку слева.';practicePaint('[data-practice-action="match-left"]:not(:disabled)');return;}
  if(a.selectedLeft===i){
   a.matched.push(i);a.feedback='Пара найдена. '+e.matching.pairs[i].explanation;a.selectedLeft=null;a.wrongRight=null;
   if(a.matched.length===e.matching.pairs.length){practiceRecord(a,e.matching.pairs.length-a.missed.length,e.matching.pairs.length);practicePaint('.practice-result-heading');}
   else practicePaint('[data-practice-action="match-left"]:not(:disabled)');
  }else{
   a.mistakes++;if(!a.missed.includes(a.selectedLeft))a.missed.push(a.selectedLeft);a.wrongRight=i;a.feedback='Эти карточки не образуют пару. Выбранное понятие осталось активным — попробуйте другую связь.';practicePaint('[data-practice-action="match-right"]:not(:disabled)');
  }
 }else if(action==='case-select'){
  const i=Number(button.dataset.practiceAnswer);if(a.checked||!Number.isInteger(i)||!e.case.questions[a.position].options[i])return;
  a.selected=i;practicePaint(`[data-practice-action="case-select"][data-practice-answer="${i}"]`);
 }else if(action==='case-check'){
  if(a.checked||a.selected===null)return;a.checked=true;a.answers[a.position]=a.selected;
  if(a.position===e.case.questions.length-1){const correct=e.case.questions.reduce((n,q,i)=>n+(a.answers[i]===q.answer?1:0),0);practiceRecord(a,correct,e.case.questions.length);practicePaint('.practice-result-heading');}
  else practicePaint('.practice-case-feedback');
 }else if(action==='case-next'){
  if(!a.checked||a.position>=e.case.questions.length-1)return;a.position++;a.selected=null;a.checked=false;practicePaint('#practice-case-question');
 }
}
document.addEventListener('click',event=>{const control=event.target.closest('[data-practice-action]');if(control)practiceHandleAction(control);});
document.addEventListener('input',event=>{if(event.target.id!=='practice-search')return;const query=event.target.value.trim().toLocaleLowerCase('ru').replaceAll('ё','е');let count=0;document.querySelectorAll('[data-practice-topic]').forEach(card=>{const match=card.dataset.practiceSearch.replaceAll('ё','е').includes(query);card.hidden=!match;if(match)count++;});const output=document.getElementById('practice-topic-count');if(output)output.textContent=`Тем: ${count}`;});
