const MovieDB = (() => {
  const DB_NAME = 'movieCatalogue', DB_VERSION = 2;
  let db = null, opening = null;
  const preferenceKeys = ['manualTop10', 'manualTop25', 'ratingScale'];
  const metadataFields = ['overview','cast','crew','directorCredits','runtime','backdrop','voteAverage','voteCount','imdbId','imdbRating','imdbVotes','rtScore','creditsFetchedAt'];
  const now = () => new Date().toISOString();
  const time = v => Number.isFinite(Date.parse(v)) ? Date.parse(v) : 0;
  const movieKey = m => m.tmdbId ? `tmdb:${m.tmdbId}` : `local:${m.uid}`;
  const legacyUid = m => `legacy-${encodeURIComponent(JSON.stringify([m.title,m.year,m.dateAdded,m.id]))}`;
  function stored(key, fallback) {
    try {
      const value=JSON.parse(localStorage.getItem(key));
      if(Array.isArray(fallback)) return Array.isArray(value)?value:fallback;
      if(fallback && typeof fallback==='object') return value && typeof value==='object' && !Array.isArray(value)?value:fallback;
      return value ?? fallback;
    } catch (_) { return fallback; }
  }
  function preferenceChanged(key) {
    const times = stored('preferenceUpdatedAt', {});
    times[key] = now();
    localStorage.setItem('preferenceUpdatedAt', JSON.stringify(times));
  }
  function open() {
    if (db) return Promise.resolve(db);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('movies')) {
          const store = database.createObjectStore('movies', {keyPath:'id', autoIncrement:true});
          for (const field of ['tmdbId','title','rating','dateAdded','year']) store.createIndex(field,field);
        }
        if (!database.objectStoreNames.contains('metadata')) database.createObjectStore('metadata');
        if (!database.objectStoreNames.contains('directors')) database.createObjectStore('directors',{keyPath:'id'});
        // Keep existing IDs so local rankings and links survive the migration.
        const requestCursor = request.transaction.objectStore('movies').openCursor();
        requestCursor.onsuccess = () => {
          const row = requestCursor.result;
          if (!row) return;
          const m = row.value;
          m.uid = m.uid || (m.tmdbId ? `tmdb-${m.tmdbId}` : legacyUid(m));
          if (m.tmdbId) m.tmdbId = String(m.tmdbId);
          m.updatedAt = m.updatedAt || m.dateAdded || '';
          row.update(m); row.continue();
        };
      };
      request.onsuccess = () => {
        db = request.result;
        db.onversionchange = () => { db.close(); db = null; opening = null; };
        resolve(db);
      };
      request.onblocked = () => { if (typeof UI !== 'undefined') UI.showToast('Close other Movie Catalogue tabs to finish the update.',8000); };
      request.onerror = () => { opening = null; reject(request.error); };
    });
    return opening;
  }
  async function transaction(stores, mode, work, expectedRevision) {
    const database = await open();
    return new Promise((resolve,reject) => {
      const tx = database.transaction(mode==='readwrite'?[...new Set([...stores,'metadata'])]:stores,mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error('The database operation was cancelled.'));
      tx.onerror = () => {};
      const perform=()=>{try { work(tx,value => {result=value;}); } catch(error) { tx.abort(); reject(error); }};
      if(mode==='readwrite') {
        const meta=tx.objectStore('metadata'),request=meta.get('revision');
        request.onsuccess=()=>{
          if(expectedRevision!==undefined && (request.result || 0)!==expectedRevision) {
            tx.abort();reject(new Error('Your collection changed while this operation was preparing. Try again.'));return;
          }
          meta.put((request.result || 0)+1,'revision');perform();
        };
      } else perform();
    });
  }
  function read(store,key) {
    return transaction([store],'readonly',(tx,done) => {
      const request = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
      request.onsuccess = () => done(request.result);
    });
  }
  function cleanUrl(value) {
    const s = String(value || '').trim();
    return /^https?:\/\/[^\s"'<>\\]+$/i.test(s) ? s : '';
  }
  function validateMovie(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.title !== 'string' || !input.title.trim()) throw new Error('Each movie must have a title. Your collection has not been replaced.');
    const m = {...input};
    for(const field of ['dateAdded','updatedAt','creditsFetchedAt']) if(m[field]!==undefined && typeof m[field]!=='string') throw new Error(`Invalid ${field} for ${m.title}`);
    for(const field of ['watchlist','pinned']) if(m[field]!==undefined && typeof m[field]!=='boolean') throw new Error(`Invalid ${field} for ${m.title}`);
    for (const field of ['genres','directors','tags']) {
      if (m[field] !== undefined && (!Array.isArray(m[field]) || m[field].some(v => typeof v !== 'string'))) throw new Error(`Invalid ${field} for ${m.title}`);
    }
    for (const field of ['cast','crew','directorCredits']) {
      if (m[field] === undefined) continue;
      if (!Array.isArray(m[field]) || m[field].some(p => !p || typeof p !== 'object' || Array.isArray(p) || typeof p.name !== 'string' || (p.roles !== undefined && (!Array.isArray(p.roles) || p.roles.some(r => typeof r !== 'string'))))) throw new Error(`Invalid ${field} for ${m.title}`);
      m[field] = m[field].map(p => ({...p,profileUrl:cleanUrl(p.profileUrl),personId:/^[1-9]\d*$/.test(String(p.personId || '')) ? Number(p.personId) : undefined}));
    }
    if (m.tmdbId !== undefined && m.tmdbId !== null && m.tmdbId !== '') {
      if (!/^[1-9]\d*$/.test(String(m.tmdbId))) throw new Error(`Invalid movie ID for ${m.title}`);
      m.tmdbId = String(m.tmdbId);
    }
    for (const field of ['rating','runtime','voteAverage','voteCount','imdbRating','resumeSeconds','rewatches']) {
      if (m[field] !== undefined && (!Number.isFinite(m[field]) || m[field] < 0)) throw new Error(`Invalid ${field} for ${m.title}`);
    }
    if ((m.rating || 0) > 10) throw new Error(`Invalid rating for ${m.title}`);
    if (m.year !== undefined && !/^(\d{4})?$/.test(String(m.year))) throw new Error(`Invalid year for ${m.title}`);
    for (const field of ['notes','overview','imdbVotes','rtScore']) if (m[field] !== undefined && typeof m[field] !== 'string') throw new Error(`Invalid ${field} for ${m.title}`);
    m.imdbId = /^tt\d+$/.test(m.imdbId || '') ? m.imdbId : '';
    for (const field of ['poster','backdrop']) if (field in m) m[field] = cleanUrl(m[field]);
    m.uid = typeof m.uid === 'string' && m.uid ? m.uid : (m.tmdbId ? `tmdb-${m.tmdbId}` : legacyUid(m));
    m.updatedAt = m.updatedAt || m.dateAdded || '';
    return m;
  }
  function addMovie(input) {
    const movie = validateMovie({...input,uid:input.uid || crypto.randomUUID(),dateAdded:now(),updatedAt:now()});
    delete movie.id;
    return transaction(['movies'],'readwrite',(tx,done) => {
      const store = tx.objectStore('movies');
      const add = () => {
        const meta=tx.objectStore('metadata'),history=meta.get('deleted');
        history.onsuccess=()=>{const deleted={...history.result};delete deleted[movieKey(movie)];meta.put(deleted,'deleted');};
        const req=store.add(movie);req.onsuccess=()=>done(req.result);
      };
      if (!movie.tmdbId) {add();return;}
      const lookup=store.index('tmdbId').get(movie.tmdbId);
      lookup.onsuccess=()=>{if(lookup.result) done(lookup.result.id);else add();};
    });
  }
  function updateMovie(input,options={}) {
    return transaction(['movies'],'readwrite',(tx,done) => {
      const store=tx.objectStore('movies'),req=store.get(input.id);
      req.onsuccess=()=>{
        try {
        if(!req.result) {tx.abort();return;}
        const changes=options.metadataOnly ? Object.fromEntries(metadataFields.filter(k=>k in input).map(k=>[k,input[k]])) : input;
        const movie=validateMovie({...req.result,...changes,id:req.result.id,uid:req.result.uid,updatedAt:options.metadataOnly?req.result.updatedAt:now()});
        store.put(movie);done(movie.id);
        } catch (_) { tx.abort(); }
      };
    });
  }
  function deleteMovie(id) {
    return transaction(['movies','metadata'],'readwrite',tx=>{
      const store=tx.objectStore('movies'),req=store.get(id);
      req.onsuccess=()=>{
        if(!req.result)return;
        const key=movieKey(req.result),meta=tx.objectStore('metadata'),deleted=meta.get('deleted');
        deleted.onsuccess=()=>{meta.put({...deleted.result,[key]:now()},'deleted');store.delete(id);};
      };
    });
  }
  const getMovie=id=>read('movies',id),getAllMovies=()=>read('movies');
  const getDirector=id=>read('directors',Number(id)),getDirectors=()=>read('directors');
  function putDirector(director) {return transaction(['directors'],'readwrite',tx=>tx.objectStore('directors').put(director));}
  const getDirectorFavourites=async()=>(await read('metadata','directorFavourites')) || {};
  function setDirectorFavourite(id,favourite) {
    return transaction(['metadata'],'readwrite',tx=>{
      const store=tx.objectStore('metadata'),req=store.get('directorFavourites');
      req.onsuccess=()=>store.put({...req.result,[Number(id)]:{favourite:!!favourite,updatedAt:now()}},'directorFavourites');
    });
  }
  async function snapshot() {
    const {movies,deleted,directorFavourites,directors,revision}=await transaction(['movies','metadata','directors'],'readonly',(tx,done)=>{
      const result={};
      for(const [key,store,id] of [['movies','movies'],['directors','directors'],['deleted','metadata','deleted'],['directorFavourites','metadata','directorFavourites'],['revision','metadata','revision']]) {
        const request=id===undefined?tx.objectStore(store).getAll():tx.objectStore(store).get(id);
        request.onsuccess=()=>{result[key]=request.result;done(result);};
      }
    });
    const byId=new Map(movies.map(m=>[m.id,movieKey(m)])),times=stored('preferenceUpdatedAt',{}),settings={};
    for(const key of preferenceKeys) {
      const value=key==='ratingScale' ? (localStorage.getItem(key)==='five'?'five':'ten') : stored(key,[]).map(id=>byId.get(Number(id))).filter(Boolean);
      settings[key]={value,updatedAt:times[key] || ''};
    }
    return {format:'movie-catalogue',version:2,ratingSystem:'ten',exportedAt:now(),movies,settings,deleted:deleted || {},directorFavourites:directorFavourites || {},directors,revision:revision || 0};
  }
  async function exportData() {return JSON.stringify(await snapshot(),null,2);}
  function parseData(value) {
    const parsed=typeof value==='string'?JSON.parse(value):value,legacy=Array.isArray(parsed);
    if(!legacy && (!parsed || parsed.format!=='movie-catalogue' || parsed.version!==2 || !Array.isArray(parsed.movies))) throw new Error('Unsupported backup format. Your collection has not been replaced.');
    const source=legacy?{movies:parsed}:parsed,movies=source.movies.map(validateMovie);
    // Preserve duplicates from older collections when restoring their own backup.
    const settings=source.settings || {};
    if(typeof settings!=='object' || Array.isArray(settings)) throw new Error('Invalid backup preferences.');
    for(const key of preferenceKeys) {
      const s=settings[key];if(!s)continue;
      if(typeof s!=='object' || (s.updatedAt!==undefined && typeof s.updatedAt!=='string') || (key==='ratingScale'?!['ten','five'].includes(s.value):!Array.isArray(s.value) || s.value.some(k=>typeof k!=='string'))) throw new Error('Invalid backup preferences.');
    }
    for(const name of ['deleted','directorFavourites']) if(source[name] && (typeof source[name]!=='object' || Array.isArray(source[name]))) throw new Error('Invalid backup metadata.');
    for(const date of Object.values(source.deleted || {})) if(typeof date!=='string') throw new Error('Invalid deletion history.');
    for(const [key,fav] of Object.entries(source.directorFavourites || {})) if(!/^[1-9]\d*$/.test(key) || !fav || typeof fav.favourite!=='boolean' || typeof fav.updatedAt!=='string') throw new Error('Invalid director favourites.');
    if(source.directors!==undefined && !Array.isArray(source.directors)) throw new Error('Invalid director profiles.');
    const directors=(source.directors || []).filter(d=>d && Number.isSafeInteger(d.id) && d.id>0 && typeof d.name==='string').map(d=>({...d,profileUrl:cleanUrl(d.profileUrl),films:Array.isArray(d.films)?d.films.filter(f=>f && Number.isSafeInteger(f.id) && typeof f.title==='string').map(f=>({...f,releaseDate:typeof f.releaseDate==='string'?f.releaseDate:'',year:typeof f.year==='string'?f.year:'',poster:cleanUrl(f.poster)})):[]}));
    return {...source,movies,settings,deleted:source.deleted || {},directorFavourites:source.directorFavourites || {},directors,legacy};
  }
  async function applyData(data,current,recover=true) {
    const previous=current || await snapshot(),existing=new Map(previous.movies.map(m=>[movieKey(m),m])),resolved=new Map();
    await transaction(['movies','metadata','directors'],'readwrite',(tx,done)=>{
      const store=tx.objectStore('movies'),meta=tx.objectStore('metadata');
      if(recover)meta.put(previous,'recoveryBackup');
      store.clear();
      const usedIds=new Set();
      for(const original of data.movies) {
        const m={...original},local=existing.get(movieKey(m));
        if(local && !usedIds.has(local.id)) {m.id=local.id;usedIds.add(m.id);}else delete m.id;
        const req=store.put(m);req.onsuccess=()=>resolved.set(movieKey(m),req.result);
      }
      meta.put(data.deleted || {},'deleted');meta.put(data.directorFavourites || {},'directorFavourites');
      for(const d of data.directors || [])tx.objectStore('directors').put(d);
      done(data.movies.length);
    },previous.revision);
    const settings=data.legacy?previous.settings:{...previous.settings,...data.settings},times=stored('preferenceUpdatedAt',{});
    for(const key of preferenceKeys) {
      const s=settings[key];if(!s)continue;
      localStorage.setItem(key,key==='ratingScale'?s.value:JSON.stringify(s.value.map(k=>resolved.get(k)).filter(id=>id!==undefined).slice(0,key==='manualTop10'?10:25)));
      times[key]=s.updatedAt || '';
    }
    localStorage.setItem('preferenceUpdatedAt',JSON.stringify(times));
    localStorage.setItem('ratingMigrated10','1');
    if(typeof UI!=='undefined')UI.setRatingScale(localStorage.getItem('ratingScale') || 'ten',false);
    return data.movies.length;
  }
  async function importData(value) {
    const data=parseData(value),current=await snapshot();
    if(data.legacy) {data.directorFavourites=current.directorFavourites;data.directors=current.directors;}
    const keys=new Set(data.movies.map(movieKey));data.deleted={...current.deleted,...data.deleted};
    for(const m of current.movies)if(!keys.has(movieKey(m)))data.deleted[movieKey(m)]=now();
    for(const m of data.movies)delete data.deleted[movieKey(m)];
    return applyData(data,current);
  }
  function latestMap(local,remote) {
    const result={...local};
    for(const [key,value] of Object.entries(remote))if(!result[key] || time(value.updatedAt)>time(result[key].updatedAt))result[key]=value;
    return result;
  }
  async function mergeData(value) {
    const remote=parseData(value),local=await snapshot(),movies=new Map(local.movies.map(m=>[movieKey(m),m]));
    for(const m of remote.movies) {const key=movieKey(m),existing=movies.get(key);if(!existing || time(m.updatedAt)>time(existing.updatedAt))movies.set(key,m);}
    const deleted={...local.deleted};
    for(const [key,date] of Object.entries(remote.deleted))if(time(date)>time(deleted[key]))deleted[key]=date;
    for(const [key,m] of movies)if(deleted[key] && time(deleted[key])>=time(m.updatedAt))movies.delete(key);
    const directors=new Map(local.directors.map(d=>[d.id,d]));
    for(const d of remote.directors)if(!directors.has(d.id) || time(d.fetchedAt)>time(directors.get(d.id).fetchedAt))directors.set(d.id,d);
    return applyData({...local,movies:[...movies.values()],deleted,settings:latestMap(local.settings,remote.settings),directorFavourites:latestMap(local.directorFavourites,remote.directorFavourites),directors:[...directors.values()]},local);
  }
  async function clearData() {
    const current=await snapshot(),data={...current,movies:[],deleted:{...current.deleted},settings:{...current.settings}};
    for(const m of current.movies)data.deleted[movieKey(m)]=now();
    for(const key of ['manualTop10','manualTop25'])data.settings[key]={value:[],updatedAt:now()};
    return applyData(data,current);
  }
  async function restoreRecovery() {
    const backup=await read('metadata','recoveryBackup');if(!backup)throw new Error('There is no recovery backup yet.');
    return importData(backup);
  }
  return {open,addMovie,updateMovie,deleteMovie,getMovie,getAllMovies,exportData,importData,parseData,mergeData,clearData,restoreRecovery,getDirector,getDirectors,putDirector,getDirectorFavourites,setDirectorFavourite,preferenceChanged,movieKey};
})();
