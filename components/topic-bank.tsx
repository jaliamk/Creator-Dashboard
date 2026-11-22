import { useMemo, useState } from 'react'
import { Archive, Search } from 'lucide-react'
import { StudioDialog } from '@/components/ui/dialog'
import type { Project, Topic } from '@/lib/studio'

const statuses = { idea:'Idea', exploring:'Exploring', ready:'Ready', converted:'Converted' }
const priorities = { 1:'High',2:'Medium',3:'Low' } as const

export function TopicBank({ topics,projects,edit,convert,link,open }: {
  topics:Topic[]; projects:Project[]; edit:(topic:Topic)=>void; convert:(topic:Topic)=>void;
  link:(topic:Topic)=>void; open:(project:Project)=>void
}) {
  const [search,setSearch]=useState('')
  const [status,setStatus]=useState('')
  const [category,setCategory]=useState('')
  const [sort,setSort]=useState('priority')
  const [archive,setArchive]=useState(false)
  const [page,setPage]=useState(0)
  const [type,setType]=useState('')
  const categories=[...new Set(topics.map(topic=>topic.category).filter(Boolean))].sort()
  const types=[...new Set(topics.map(topic=>topic.content_type))].sort()
  const visible=useMemo(()=>topics.filter(topic=>{
    const searchValue=search.trim().toLowerCase()
    return topic.archived===archive && (!status || topic.status===status) && (!category || topic.category===category)
      && (!type || topic.content_type===type) && (!searchValue ||
        [topic.title,topic.description,topic.notes,topic.category,...topic.links].some(value=>value.toLowerCase().includes(searchValue)))
  }).sort((a,b)=>sort==='title'?a.title.localeCompare(b.title):
    sort==='newest'?b.created_at.localeCompare(a.created_at):a.priority-b.priority||b.created_at.localeCompare(a.created_at)),
  [topics,search,status,category,type,sort,archive])
  const pageSize=20
  const pageCount=Math.max(1,Math.ceil(visible.length/pageSize))
  const index=Math.min(page,pageCount-1)
  return <section className="panel topic-bank" aria-label="Video ideas">
    <div className="production-toolbar">
      <label className="topic-search">Search ideas<span><Search size={17}/><input value={search} placeholder="Title, notes, or link" onChange={event=>{setSearch(event.target.value);setPage(0)}}/></span></label>
      <label>Status<select value={status} onChange={event=>{setStatus(event.target.value);setPage(0)}}><option value="">All statuses</option>
        {Object.entries(statuses).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
      <label>Category<select value={category} onChange={event=>{setCategory(event.target.value);setPage(0)}}><option value="">All categories</option>
        {categories.map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Content type<select value={type} onChange={event=>{setType(event.target.value);setPage(0)}}><option value="">All types</option>
        {types.map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Sort by<select value={sort} onChange={event=>{setSort(event.target.value);setPage(0)}}><option value="priority">Priority</option><option value="newest">Newest</option><option value="title">Title</option></select></label>
      <button className="button secondary" aria-pressed={archive} onClick={()=>{setArchive(!archive);setPage(0)}}><Archive size={15}/>{archive?'Show active':'Show archived'}</button>
    </div>
    <div className="topic-count muted">{visible.length} {visible.length===1?'idea':'ideas'}</div>
    {visible.slice(index*pageSize,(index+1)*pageSize).map(topic=>{
      const project=projects.find(item=>item.id===topic.project_id)
      return <article key={topic.id} className="topic-row list-row">
        <div className="row-copy"><strong>{topic.title}</strong>
          <small>{statuses[topic.status]} · {topic.category||'Uncategorized'} · {topic.content_type} · {priorities[topic.priority as keyof typeof priorities]} priority</small>
          {topic.description&&<p className="topic-description">{topic.description}</p>}
        </div>
        <div className="actions">
          <button className="text-button" onClick={()=>edit(topic)}>Edit</button>
          {project?<button className="button secondary compact" onClick={()=>open(project)}>Open project</button>:<>
            <button className="text-button" onClick={()=>link(topic)}>Link existing</button>
            <button className="button primary compact" onClick={()=>convert(topic)}>Add as Project</button>
          </>}
        </div>
      </article>
    })}
    {!visible.length&&<p className="gantt-empty muted">No ideas match these filters.</p>}
    {pageCount>1&&<div className="actions topic-pagination">
      <button className="button secondary compact" disabled={index===0} onClick={()=>setPage(index-1)}>Previous</button><span>{index+1} of {pageCount}</span>
      <button className="button secondary compact" disabled={index===pageCount-1} onClick={()=>setPage(index+1)}>Next</button>
    </div>}
  </section>
}

export function TopicEditor({topic,busy,error,close,save,remove}:{
  topic?:Topic;busy:boolean;error:string;close:()=>void;
  save:(id:string,data:Record<string,unknown>)=>void;remove:(topic:Topic)=>void
}) {
  const [id]=useState(()=>topic?.id??crypto.randomUUID())
  return <StudioDialog title={topic?'Edit idea':'New idea'} description="Capture an idea now and develop it into a video later." close={()=>{if(!busy)close()}}>
    <form className="form" onSubmit={event=>{
      event.preventDefault()
      const fields=new FormData(event.currentTarget)
      save(id,{title:fields.get('title'),description:fields.get('description'),notes:fields.get('notes'),
        links:String(fields.get('links')).split(/\r?\n/).map(link=>link.trim()).filter(Boolean),
        category:fields.get('category'),type:fields.get('type'),priority:Number(fields.get('priority')),
        status:fields.get('status')??topic?.status??'idea',archived:fields.has('archived')})
    }}>
      <label>Idea title<input name="title" required maxLength={120} defaultValue={topic?.title}/></label>
      <label>Description<textarea name="description" rows={2} maxLength={4000} defaultValue={topic?.description}/></label>
      <label>Notes<textarea name="notes" rows={3} defaultValue={topic?.notes}/></label>
      <label>Links, one per line<textarea name="links" rows={2} defaultValue={topic?.links.join('\n')}/></label>
      <div className="form-grid">
        <label>Category<input name="category" defaultValue={topic?.category}/></label>
        <label>Content type<input name="type" required defaultValue={topic?.content_type??'Video'}/></label>
        <label>Status<select name="status" disabled={Boolean(topic?.project_id)} defaultValue={topic?.status??'idea'}>
          {Object.entries(statuses).filter(([key])=>key!=='converted'||topic?.status==='converted').map(([key,label])=><option value={key} key={key}>{label}</option>)}
        </select></label>
        <label>Priority<select name="priority" defaultValue={topic?.priority??2}><option value={1}>High</option><option value={2}>Medium</option><option value={3}>Low</option></select></label>
      </div>
      {topic&&<label className="checkbox"><input name="archived" type="checkbox" defaultChecked={topic.archived}/>Archive idea</label>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">{topic&&<button type="button" className="text-button danger-text push" onClick={()=>remove(topic)}>Delete idea</button>}
        <button className="button primary" disabled={busy}>Save idea</button></div>
    </form>
  </StudioDialog>
}

export function TopicLink({topic,projects,busy,error,close,save}:{
  topic:Topic;projects:Project[];busy:boolean;error:string;close:()=>void;save:(id:string)=>void
}) {
  return <StudioDialog title="Link existing project" description={topic.title} close={()=>{if(!busy)close()}}>
    <form className="form" onSubmit={event=>{event.preventDefault();save(String(new FormData(event.currentTarget).get('project'))) }}>
      <label>Project<select name="project" required defaultValue=""><option value="" disabled>Select project</option>
        {projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="button primary" disabled={busy||!projects.length}>Link project</button></div>
    </form>
  </StudioDialog>
}
