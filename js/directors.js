// Director identities, cached profiles and the two Directors routes.
const Directors = (() => {
  const TTL = 7 * 86400000;
  const pending = new Map(), profileStates = new Map();
  let epoch = 0, hooks = {}, query = '', sort = 'watched', onlyFavourites = false;
  let searchTimer, library = [], favourites = {}, activeProfile = null;
  const esc = value => UI.escapeHtml(value);
  const root = () => document.getElementById('directors-content');
  const cancel = () => { epoch++; clearTimeout(searchTimer); };
  const credits = movie => movie.directorCredits?.length ? movie.directorCredits
    : (movie.crew || []).filter(p => (p.roles || []).includes('Director'));
  const nameKey = name => `name:${encodeURIComponent(name)}`;
  const average = films => {
    const rated = films.filter(m => m.rating > 0);
    return {rated:rated.length, score:rated.length ? rated.reduce((s,m)=>s+m.rating,0)/rated.length : 0};
  };
  const scoreText = score => UI.isFiveStar() ? `${(score/2).toFixed(1)}/5` : `${score.toFixed(1)}/10`;
  function released(film) {
    return !!film.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(film.releaseDate) && film.releaseDate <= today();
  }
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function owns(movie, director) {
    if (credits(movie).some(p => p.personId === director.id)) return true;
    if (credits(movie).some(p => p.name === director.name && p.personId && p.personId !== director.id)) return false;
    return (movie.directors || []).includes(director.name) &&
      (!director.fetchedAt || director.films.some(f => String(f.id) === String(movie.tmdbId)));
  }
  async function profile(id) {
    id = Number(id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid director ID.');
    if (pending.has(id)) return pending.get(id);
    const task = (async () => {
      const cached = await MovieDB.getDirector(id);
      if (cached?.fetchedAt && Date.now()-Date.parse(cached.fetchedAt) < TTL) return cached;
      try {
        const person = await TMDB.getPersonDetails(id), seen = new Set();
        const films = (person.movie_credits?.crew || [])
          .filter(f => f.job === 'Director' && f.id && !seen.has(f.id) && seen.add(f.id))
          .map(f => ({id:f.id,title:f.title || f.original_title || 'Untitled',
            releaseDate:f.release_date || '', year:(f.release_date || '').slice(0,4),
            poster:TMDB.posterUrl(f.poster_path,'w342'), voteAverage:f.vote_average || 0,voteCount:f.vote_count || 0}));
        const result = {id,name:person.name,biography:person.biography || '',
          profileUrl:TMDB.profileUrl(person.profile_path,'h632'),
          placeOfBirth:person.place_of_birth || '', birthday:person.birthday || '',
          films,fetchedAt:new Date().toISOString()};
        await MovieDB.putDirector(result);
        return result;
      } catch (error) {
        if (cached) return {...cached,offline:true};
        throw error;
      }
    })();
    pending.set(id,task);
    try { return await task; } finally { pending.delete(id); }
  }
  async function knownByName(name) {
    const [movies,cached] = await Promise.all([MovieDB.getAllMovies(),MovieDB.getDirectors()]);
    const ids = new Set(movies.flatMap(credits).filter(p => p.name===name && p.personId).map(p=>p.personId));
    if (ids.size===1) return profile([...ids][0]);
    const exact = cached.filter(p => p.name===name);
    if (exact.length===1) return profile(exact[0].id);
    // Ambiguous names require a person choice on the profile route.
    const people = (await TMDB.searchPerson(name,true)).filter(p => p.name.toLocaleLowerCase()===name.toLocaleLowerCase());
    if (people.length!==1) return null;
    return profile(people[0].id);
  }
  function openByName(name) { window.location.hash = `#director/${nameKey(name)}`; }
  function statsFor(movies,director) {
    const related = movies.filter(m => owns(m,director));
    const watched = related.filter(m => !m.watchlist), queued = related.filter(m => m.watchlist);
    const stats = average(watched);
    const best = watched.filter(m=>m.rating>0).sort((a,b)=>b.rating-a.rating)[0];
    return {watched,queued,best,...stats};
  }
  function favouriteButton(id,name) {
    if (!id) return '';
    const selected = !!favourites[id]?.favourite;
    return `<button class="btn director-favourite${selected?' is-favourite':''}" type="button" data-favourite="${id}" aria-pressed="${selected}" aria-label="${selected?'Unfavourite':'Favourite'} ${esc(name)}">${selected?'★':'☆'}</button>`;
  }
  function portrait(person,className='director-portrait') {
    return person.profileUrl
      ? `<img class="${className}" src="${UI.imgSrc(person.profileUrl)}" alt="" loading="lazy">`
      : `<span class="${className} director-initials" aria-hidden="true">${esc(person.name.split(/\s+/).map(w=>w[0]).join('').slice(0,2))}</span>`;
  }
  async function loadLibrary() {
    const run = ++epoch;
    activeProfile = null;
    root().innerHTML = '<p class="no-results">Loading your directors…</p>';
    const [movies,cached,favs] = await Promise.all([MovieDB.getAllMovies(),MovieDB.getDirectors(),MovieDB.getDirectorFavourites()]);
    if (run !== epoch) return;
    favourites = favs;
    const knownNames = new Map();
    for(const d of cached) {
      if(!knownNames.has(d.name)) knownNames.set(d.name,[]);
      knownNames.get(d.name).push(d);
    }
    const people = new Map();
    for(const m of movies) {
      for(const name of m.directors || []) {
        const matches = credits(m).filter(p=>p.name===name && p.personId);
        const found = matches[0] || (knownNames.get(name)?.length===1 ? knownNames.get(name)[0] : null);
        const id = found?.personId || found?.id;
        const key = id ? String(id) : nameKey(name);
        if (!people.has(key)) people.set(key,{id,name,profileUrl:found?.profileUrl || '',films:[],key,local:[]});
        people.get(key).local.push(m);
      }
    }
    for(const d of cached) {
      if(people.has(String(d.id))) people.set(String(d.id),{...people.get(String(d.id)),...d});
      else if(favs[d.id]?.favourite) people.set(String(d.id),{...d,key:String(d.id),local:[]});
    }
    library = [...people.values()].map(d=>{
      const watched=d.local.filter(m=>!m.watchlist),queued=d.local.filter(m=>m.watchlist);
      const unique=[...new Map(watched.map(m=>[MovieDB.movieKey(m),m])).values()];
      const rated=average(unique),best=unique.filter(m=>m.rating>0).sort((a,b)=>b.rating-a.rating)[0];
      return {...d,watched:unique,queued,best,...rated};
    });
    root().innerHTML = `<div class="directors-library">
      <div class="directors-heading"><div><h2>Your directors</h2><p>${library.length} filmmaker${library.length===1?'':'s'} in your collection and favourites</p></div></div>
      <form class="directors-search" id="director-search-form"><label class="sr-only" for="director-search">Find a director</label><input class="search-input" id="director-search" type="search" placeholder="Find a director in your collection or on TMDB" value="${esc(query)}"><button class="btn btn-primary" type="submit">Search</button></form>
      <div class="directors-tools"><button class="btn btn-secondary" id="director-favourites-only" type="button" aria-pressed="${onlyFavourites}">★ Favourites</button><label class="director-sort-label" for="director-sort">Sort<select id="director-sort"><option value="watched">Most watched</option><option value="rated">Highest rated · 3+ ratings</option><option value="name">Name</option></select></label></div>
      <div id="director-search-results" aria-live="polite"></div>
      <div id="director-library-grid" class="director-library-grid"></div>
    </div>`;
    root().querySelector('#director-sort').value = sort;
    root().querySelector('#director-sort').addEventListener('change',e=>{sort=e.target.value;renderCards();});
    root().querySelector('#director-favourites-only').addEventListener('click',e=>{
      onlyFavourites=!onlyFavourites;e.currentTarget.setAttribute('aria-pressed',String(onlyFavourites));renderCards();
    });
    const input=root().querySelector('#director-search');
    input.addEventListener('input',()=>{query=input.value;renderCards();clearTimeout(searchTimer);if(query.trim().length>=2)searchTimer=setTimeout(()=>searchPeople(run),350);else root().querySelector('#director-search-results').replaceChildren();});
    root().querySelector('#director-search-form').addEventListener('submit',e=>{e.preventDefault();clearTimeout(searchTimer);searchPeople(run);});
    renderCards();
    if(query.trim().length>=2)searchPeople(run);
  }
  function renderCards() {
    const grid=root().querySelector('#director-library-grid');if(!grid)return;
    const text=query.trim().toLocaleLowerCase();
    const shown=library.filter(d=>(!text || d.name.toLocaleLowerCase().includes(text)) && (!onlyFavourites || favourites[d.id]?.favourite));
    shown.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='rated'?
      (b.rated>=3?b.score:-1)-(a.rated>=3?a.score:-1) || b.watched.length-a.watched.length:
      b.watched.length-a.watched.length || a.name.localeCompare(b.name));
    grid.innerHTML = shown.length ? shown.map(d=>{
      const art=d.best?.backdrop || d.watched.find(m=>m.backdrop)?.backdrop;
      const chips=[...d.watched].sort((a,b)=>(b.rating||0)-(a.rating||0)).slice(0,3);
      return `<article class="director-card"${art?` style="--director-art:url('${esc(UI.cssUrl(art))}')"`:''}>
        ${favouriteButton(d.id,d.name)}<a class="director-card-main" href="#director/${esc(d.key)}">
          ${portrait(d)}<h3>${esc(d.name)}</h3>
          <div class="director-card-count"><strong>${d.watched.length}</strong> watched${d.queued.length?` · ${d.queued.length} watchlisted`:''}</div>
          ${d.rated?`<p class="director-card-average">${scoreText(d.score)} <span>from ${d.rated} rating${d.rated===1?'':'s'}</span></p>`:'<p class="director-card-average">Your next discovery</p>'}
          ${d.best?`<p class="director-best">Your favourite <strong>${esc(d.best.title)}</strong></p>`:''}
          ${chips.length?`<div class="director-film-strip" aria-hidden="true">${chips.map(m=>m.poster?`<img src="${UI.imgSrc(m.poster)}" alt="" loading="lazy">`:'').join('')}</div>`:''}
        </a></article>`;
    }).join('') : `<p class="directors-empty">${onlyFavourites?'Favourite a director from their profile to keep them here.':text?'No directors in your collection match. Search TMDB to discover someone.':'Your directors will appear as you add films. You can also search and favourite a filmmaker.'}</p>`;
  }
  async function searchPeople(run) {
    const q=query.trim(), target=root().querySelector('#director-search-results');
    if(!q || !target)return;
    target.innerHTML='<p class="form-hint">Searching TMDB…</p>';
    try {
      const results=await TMDB.searchPerson(q,true);
      if(run!==epoch || query.trim()!==q || !target.isConnected)return;
      target.innerHTML=`<h3 class="directors-search-label">From TMDB</h3>${peopleRows(results.slice(0,8))}`;
    } catch(_) { if(run===epoch && target.isConnected)target.innerHTML='<p class="form-hint">TMDB search is unavailable. Your saved directors are still below.</p>'; }
  }
  function peopleRows(results) {
    if(!results.length)return '<p class="form-hint">No people found. Try another name.</p>';
    return `<div class="director-person-results">${results.map(p=>`<a class="director-person-result" href="#director/${Number(p.id)}">${portrait({name:p.name,profileUrl:TMDB.profileUrl(p.profile_path)})}<span><strong>${esc(p.name)}</strong><small>${esc((p.known_for || []).map(f=>f.title || f.name).filter(Boolean).slice(0,2).join(', '))}</small></span></a>`).join('')}</div>`;
  }
  async function loadProfile(key) {
    const run=++epoch;activeProfile=null;
    root().innerHTML='<p class="no-results">Loading director…</p>';
    try {
      let director;
      if(key.startsWith('name:')) {
        const name=decodeURIComponent(key.slice(5));
        director=await knownByName(name);
        if(run!==epoch)return;
        if(!director) {
          const people=await TMDB.searchPerson(name,true);if(run!==epoch)return;
          root().innerHTML=`<a href="#directors" class="btn-back">‹ Directors</a><h2 class="director-choose-title">Choose ${esc(name)}</h2><p class="form-hint">Pick the person to open their directing credits.</p>${peopleRows(people)}`;
          return;
        }
        history.replaceState(null,'',`#director/${director.id}`);
      } else director=await profile(key);
      const [movies,favs]=await Promise.all([MovieDB.getAllMovies(),MovieDB.getDirectorFavourites()]);
      if(run!==epoch)return;
      favourites=favs;activeProfile=director;
      renderProfile(director,movies);
    } catch(error) {
      if(run!==epoch)return;
      root().innerHTML=`<a href="#directors" class="btn-back">‹ Directors</a><div class="directors-empty"><h2>Profile unavailable</h2><p>Connect to load this director for the first time.</p><button class="btn btn-secondary" data-director-retry type="button">Try again</button></div>`;
    }
  }
  function filmState(f,local) {return local ? (local.watchlist?'watchlist':'watched') : released(f)?'unseen':f.releaseDate?'upcoming':'undated';}
  function filmRow(f,local,recommendation='') {
    const state=filmState(f,local),labels={watched:'Watched',watchlist:'Watchlisted',unseen:'Unseen',upcoming:'Upcoming',undated:'Date unknown'};
    const titleAction=local ? `<a href="#detail/${local.id}" class="director-film-open">${esc(f.title)}</a>` : `<button type="button" class="director-film-open" data-director-preview="${f.id}">${esc(f.title)}</button>`;
    return `<article class="director-film-row director-film-row--${state}">
      ${f.poster?`<img class="director-film-poster" src="${UI.imgSrc(f.poster)}" alt="" loading="lazy">`:'<span class="director-film-poster director-no-poster" aria-hidden="true">◇</span>'}
      <div class="director-film-info">${titleAction}<p>${esc(f.year || 'Date unknown')} <span class="director-film-status">${labels[state]}</span></p>${recommendation?`<p class="director-film-reason">${esc(recommendation)}</p>`:''}</div>
      ${local?.rating>0?`<span class="director-film-rating">${esc(UI.ratingText(local.rating))}</span>`:''}
      ${!local?`<button type="button" class="btn btn-secondary director-film-add" data-director-add="${f.id}" aria-label="Add ${esc(f.title)} to watchlist">+ Watchlist</button>`:''}
    </article>`;
  }
  function renderProfile(director,movies) {
    const stats=statsFor(movies,director),byTmdb=new Map(movies.map(m=>[String(m.tmdbId),m]));
    const films=director.films || [], complete=!!director.fetchedAt;
    const releasedFilms=films.filter(released),watchedCount=releasedFilms.filter(f=>byTmdb.get(String(f.id)) && !byTmdb.get(String(f.id)).watchlist).length;
    const art=stats.best?.backdrop || stats.watched.find(m=>m.backdrop)?.backdrop;
    const state=profileStates.get(director.id) || {filter:'all',order:'newest'};profileStates.set(director.id,state);
    const counts={all:films.length,watched:0,watchlist:0,unseen:0,upcoming:0,undated:0};
    for(const f of films)counts[filmState(f,byTmdb.get(String(f.id)))]++;
    const next=films.filter(f=>released(f) && (!byTmdb.has(String(f.id)) || byTmdb.get(String(f.id)).watchlist))
      .sort((a,b)=>Number(!!byTmdb.get(String(b.id))?.watchlist)-Number(!!byTmdb.get(String(a.id))?.watchlist) || a.releaseDate.localeCompare(b.releaseDate)).slice(0,3);
    root().innerHTML=`<div class="director-profile">
      <a href="#directors" class="btn-back">‹ Directors</a>
      <header class="director-profile-hero"${art?` style="--director-art:url('${esc(UI.cssUrl(art))}')"`:''}>
        ${portrait(director,'director-profile-portrait')}<div class="director-profile-heading"><h2>${esc(director.name)}</h2><p>${esc(director.placeOfBirth || '')}</p>${favouriteButton(director.id,director.name)}</div>
      </header>
      <div class="director-personal-stats"><div><strong>${stats.watched.length}</strong><span>watched</span></div><div><strong>${stats.queued.length}</strong><span>watchlisted</span></div><div><strong>${stats.rated?scoreText(stats.score):'—'}</strong><span>${stats.rated} personal rating${stats.rated===1?'':'s'}</span></div></div>
      ${stats.best?`<p class="director-profile-best">Your favourite <a href="#detail/${stats.best.id}">${esc(stats.best.title)}</a> <span>${esc(UI.ratingText(stats.best.rating))}</span></p>`:''}
      ${complete && releasedFilms.length?`<div class="director-completion"><label for="director-progress">${watchedCount} of ${releasedFilms.length} released directing credits watched</label><progress id="director-progress" value="${watchedCount}" max="${releasedFilms.length}"></progress><p>Includes all released movie directing credits on TMDB, without a popularity cutoff.</p></div>`:''}
      ${director.offline?'<p class="form-hint">Showing the saved profile. Connect to refresh its filmography.</p>':`<p class="director-cache-note">Filmography saved ${director.fetchedAt?esc(new Date(director.fetchedAt).toLocaleDateString()):'for offline browsing'}.</p>`}
      ${director.biography?`<details class="director-biography"><summary>About ${esc(director.name)}</summary><p>${esc(director.biography)}</p></details>`:''}
      ${next.length?`<section class="director-next"><h3>What to watch next</h3><p class="form-hint">Your watchlist first, then continue in release order.</p>${next.map(f=>filmRow(f,byTmdb.get(String(f.id)),byTmdb.get(String(f.id))?.watchlist?'Already on your watchlist':'Next in release order')).join('')}</section>`:''}
      <section class="director-filmography"><div class="director-filmography-heading"><h3>Filmography</h3><label for="director-order" class="director-sort-label">Order<select id="director-order"><option value="newest">Newest first</option><option value="oldest">Release order</option><option value="personal">Your ratings</option></select></label></div>
        <div class="director-status-tabs" aria-label="Filter filmography">${[['all','All'],['watched','Watched'],['watchlist','Watchlisted'],['unseen','Unseen'],['upcoming','Upcoming'],['undated','Undated']].filter(([k])=>k==='all' || counts[k]).map(([k,label])=>`<button type="button" class="btn btn-secondary" data-director-filter="${k}" aria-pressed="${state.filter===k}">${label} <span>${counts[k]}</span></button>`).join('')}</div>
        <div id="director-filmography-list"></div>
      </section></div>`;
    root().querySelector('#director-order').value=state.order;
    const repaint=()=>{
      const shown=films.filter(f=>state.filter==='all' || filmState(f,byTmdb.get(String(f.id)))===state.filter);
      shown.sort((a,b)=>state.order==='personal'?(byTmdb.get(String(b.id))?.rating || 0)-(byTmdb.get(String(a.id))?.rating || 0):!a.releaseDate?1:!b.releaseDate?-1:state.order==='oldest'?a.releaseDate.localeCompare(b.releaseDate):b.releaseDate.localeCompare(a.releaseDate));
      root().querySelector('#director-filmography-list').innerHTML=shown.length?shown.map(f=>filmRow(f,byTmdb.get(String(f.id)))).join(''):'<p class="directors-empty">No films in this view.</p>';
    };
    root().querySelector('#director-order').addEventListener('change',e=>{state.order=e.target.value;repaint();});
    root().querySelectorAll('[data-director-filter]').forEach(btn=>btn.addEventListener('click',()=>{
      state.filter=btn.dataset.directorFilter;root().querySelectorAll('[data-director-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===btn)));repaint();
    }));
    repaint();
  }
  function init(callbacks) {
    hooks=callbacks;
    root().addEventListener('click',async e=>{
      const fav=e.target.closest('[data-favourite]');
      if(fav) {
        const id=Number(fav.dataset.favourite),run=epoch;fav.disabled=true;
        try {await MovieDB.setDirectorFavourite(id,!favourites[id]?.favourite);if(run===epoch)activeProfile?loadProfile(String(id)):loadLibrary();}
        catch(error) {UI.showToast(error.message);fav.disabled=false;}
        return;
      }
      const preview=e.target.closest('[data-director-preview]');
      if(preview) {hooks.openPreview(Number(preview.dataset.directorPreview),window.location.hash);return;}
      const add=e.target.closest('[data-director-add]');
      if(add) {
        const run=epoch,id=activeProfile?.id;add.disabled=true;add.textContent='Adding…';
        const ok=await hooks.addToWatchlist(Number(add.dataset.directorAdd));
        if(run!==epoch)return;
        if(ok && id)loadProfile(String(id));else {add.disabled=false;add.textContent='+ Watchlist';}
        return;
      }
      if(e.target.closest('[data-director-retry]'))loadProfile(window.location.hash.slice('#director/'.length));
    });
  }
  return {init,cancel,loadLibrary,loadProfile,openByName,knownByName};
})();
