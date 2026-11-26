/**
 * Production adapters for the on-demand Draft PR executor. Not wired to HUB
 * frontend, Cron, HTTP or GitHub Actions: requires explicitly invoked CLI.
 * Both credentials are server-only and never included in result packets.
 */
const deny = code => { throw Error('SEO_DRAFT_PR_' + code) }
const safeRepoName = name => {
  if (typeof name !== 'string') deny('INVALID_REPO')
  const parts = name.split('/')
  if (parts.length !== 2 ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(parts[0]) ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1]) ||
      parts[1] === '.' || parts[1] === '..' ||
      parts[1].startsWith('-')) deny('INVALID_REPO')
  return parts.map(encodeURIComponent).join('/')
}
const safeBranch = branch => {
  if (typeof branch !== 'string' || branch.length > 120 ||
      !/^[A-Za-z0-9._/-]+$/.test(branch) ||
      branch.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.')||p.startsWith('-')))
    deny('INVALID_BRANCH')
  return branch.split('/').map(encodeURIComponent).join('/')
}
const gitPath = name => {
  if (!name || typeof name !== 'string' || name.includes('\\') ||
      name.split('/').some(p=>!p||p==='.'||p==='..')) deny('INVALID_CONTENT_PATH')
  return name.split('/').map(encodeURIComponent).join('/')
}
async function jsonRequest(url, { method='GET', body, headers={}, allow404=false }={}) {
  const response = await fetch(url,{
    method,
    headers:{'Accept':'application/json',...headers,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(20000),
  })
  if (allow404 && response.status===404) return null
  if (!response.ok) throw Error('SEO_DRAFT_PR_REMOTE_REQUEST_FAILED_'+response.status)
  const payload=await response.json()
  return payload
}
export function githubAdapter(token) {
  if (typeof token!=='string'||token.length<20) deny('GITHUB_TOKEN_REQUIRED')
  const github = async (repo, path, options={}) =>
    jsonRequest('https://api.github.com/repos/'+safeRepoName(repo)+path,{
      ...options,headers:{
        'Authorization':'Bearer '+token,
        'X-GitHub-Api-Version':'2022-11-28',
        'Accept':'application/vnd.github+json',
      }
    })
  return {
    async getBranchHead(repo,branch) {
      const ref=await github(repo,'/git/ref/heads/'+safeBranch(branch),{allow404:true})
      return ref?.object?.sha ?? null
    },
    async getBranchRef(repo,branch) {
      const ref=await github(repo,'/git/ref/heads/'+safeBranch(branch),{allow404:true})
      return ref?.object?.sha ?? null
    },
    async getFile(repo,path,sha) {
      if(!/^[a-f0-9]{40}$/i.test(sha))deny('INVALID_COMMIT_SHA')
      const result=await github(repo,'/contents/'+gitPath(path)+'?ref='+sha,{allow404:true})
      if(!result)return null
      if(result.type!=='file'||result.encoding!=='base64')deny('NOT_TEXT_FILE')
      if(result.size>250000)deny('SOURCE_FILE_TOO_LARGE')
      const text=Buffer.from(result.content.replace(/\s/g,''),'base64').toString('utf8')
      if(text.includes('\uFFFD'))deny('INVALID_SOURCE_ENCODING')
      return {type:'file',size:result.size,blob_sha:result.sha,content:text}
    },
    async getCommitTree(repo,sha) {
      if(!/^[a-f0-9]{40}$/i.test(sha))deny('INVALID_COMMIT_SHA')
      const commit=await github(repo,'/git/commits/'+sha)
      return commit?.tree?.sha
    },
    // Commit review is read-only. If GitHub reports >100 changed files it
    // cannot match the approved <=8 file allowlist, so fail closed in core.
    async getCommitReview(repo,sha) {
      if(!/^[a-f0-9]{40}$/i.test(sha))deny('INVALID_COMMIT_SHA')
      const r=await github(repo,'/commits/'+sha+'?per_page=100')
      if(!r||r.sha!==sha||!Array.isArray(r.parents)||!Array.isArray(r.files))
        deny('INVALID_COMMIT_REVIEW')
      return {
        sha:r.sha,
        parents:r.parents.map(p=>({sha:p.sha})),
        changedFiles:r.files.map(f=>({filename:f.filename,status:f.status})),
      }
    },
    async getPullsForHead(repo,branch,baseBranch) {
      const [owner]=repo.split('/')
      const params=new URLSearchParams({
        state:'all',head:owner+':'+safeBranch(branch).replaceAll('%2F','/'),
        base:safeBranch(baseBranch).replaceAll('%2F','/'),per_page:'100',
      })
      const pulls=await github(repo,'/pulls?'+params.toString())
      if(!Array.isArray(pulls)||pulls.length>=100)deny('AMBIGUOUS_DRAFT_PR_RESULTS')
      return pulls.map(p=>({
        number:p.number,html_url:p.html_url,state:p.state,draft:p.draft,
        merged_at:p.merged_at,body:p.body,
        head:p.head?{ref:p.head.ref,sha:p.head.sha,
          repo:p.head.repo?{full_name:p.head.repo.full_name}:null}:null,
        base:p.base?{ref:p.base.ref,
          repo:p.base.repo?{full_name:p.base.repo.full_name}:null}:null,
      }))
    },
    async getOverlappingOpenPrs(repo, contentPath) {
      const pulls = await github(repo,'/pulls?state=open&per_page=100')
      if (!Array.isArray(pulls) || pulls.length >= 100) deny('OPEN_PR_SCAN_INCOMPLETE')
      const overlaps=[]
      for (const pull of pulls) {
        if (!Number.isInteger(pull.number)) deny('OPEN_PR_INVALID')
        const files = await github(repo,'/pulls/'+pull.number+'/files?per_page=100')
        if (!Array.isArray(files) || files.length >= 100) deny('OPEN_PR_FILES_INCOMPLETE')
        if (files.some(item=>item.filename===contentPath)) overlaps.push({
          number:pull.number,url:pull.html_url,base:pull.base?.ref??null
        })
      }
      return overlaps
    },
    async createTree(repo,baseTree,files) {
      const r=await github(repo,'/git/trees',{
        method:'POST',body:{
          base_tree:baseTree,
          tree:files.map(f=>({path:f.path,mode:'100644',type:'blob',content:f.content})),
        }
      })
      if(!/^[a-f0-9]{40}$/i.test(r?.sha??''))deny('INVALID_NEW_TREE')
      return r.sha
    },
    async createCommit(repo,tree,base,message) {
      const r=await github(repo,'/git/commits',{
        method:'POST',body:{message,tree,parents:[base]}
      })
      if(!/^[a-f0-9]{40}$/i.test(r?.sha??''))deny('INVALID_NEW_COMMIT')
      return r.sha
    },
    async createBranch(repo,branch,commit) {
      await github(repo,'/git/refs',{
        method:'POST',body:{ref:'refs/heads/'+safeBranch(branch).replaceAll('%2F','/'),sha:commit},
      })
    },
    async createDraftPr(repo,payload) {
      const r=await github(repo,'/pulls',{method:'POST',body:payload})
      if(!r?.draft||!Number.isInteger(r?.number)||
        r?.html_url!==('https://github.com/'+repo+'/pull/'+r.number))
        deny('INVALID_DRAFT_PR_RECEIPT')
      return {draft:true,number:r.number,url:r.html_url}
    },
  }
}
export function supabaseStore({url,key}) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url??'')) deny('INVALID_SUPABASE_HOST')
  if (typeof key!=='string'||key.length<30) deny('SUPABASE_SERVICE_ROLE_REQUIRED')
  const base=url.replace(/\/$/,'')+'/rest/v1/'
  const dbHeaders={'apikey':key,'Authorization':'Bearer '+key}
  const read=async(table,filters,select='*')=>{
    const query=new URLSearchParams({select,...Object.fromEntries(
      Object.entries(filters).map(([name,value])=>[name,'eq.'+String(value)]))})
    const rows=await jsonRequest(base+table+'?'+query.toString(),{headers:dbHeaders})
    if(!Array.isArray(rows)||rows.length>1)deny('DB_RESULT_NOT_UNIQUE_'+table)
    return rows[0]??null
  }
  return {
    async loadSnapshot(id) {
      const request=await read('commerce_seo_source_change_requests',{id})
      if(!request)deny('REQUEST_NOT_FOUND')
      const [existingRun,site,project,job,evidence,receipt,keyword]=await Promise.all([
        read('commerce_seo_source_change_pr_runs',{request_id:id}),
        read('commerce_seo_sites',{id:request.site_id},'id,enabled,origin'),
        read('commerce_seo_portfolio_projects',{site_id:request.site_id},'site_id,mapping_status,production_repo,production_branch'),
        read('commerce_seo_content_jobs',{id:request.job_id},'id,site_id,page,focus_query,status,evidence_id'),
        read('commerce_seo_content_evidence',{id:request.evidence_id},'id,job_id,source_url,source_at'),
        read('seo_connector_receipts',{id:request.gsc_receipt_id},'id,actor,site_id,query_request,created_at'),
        read('commerce_seo_portfolio_keyword_roles',{
          site_id:request.site_id,keyword:request.focus_query,approval_status:'APPROVED',
        },'site_id,keyword,approval_status,target_page'),
      ])
      return {request,existingRun,site,project,job,evidence,receipt,keyword}
    },
    async recordRun(row) {
      // No direct browser/user write. The DB trigger verifies owner approval
      // and expected source/branch/paths before storing this receipt.
      const result=await jsonRequest(base+'commerce_seo_source_change_pr_runs',{
        method:'POST',headers:{...dbHeaders,'Prefer':'return=representation'},
        body:{
          request_id:row.request_id,site_id:row.site_id,repository:row.repository,
          target_branch:row.target_branch,base_commit_sha:row.base_commit_sha,
          draft_branch:row.draft_branch,pr_number:row.pr_number,
          pr_url:row.pr_url,pr_head_sha:row.pr_head_sha,
          change_sha256:row.change_sha256,changed_paths:row.changed_paths,
        }
      })
      if(!Array.isArray(result)||result.length!==1)deny('PR_RECEIPT_WRITE_FAILED_RECONCILE')
      return result[0]
    },
  }
}
