import { readFileSync } from 'node:fs'
import { formatResultsMarkdown, type ImportResult } from './formatter.js'

const COMMENT_MARKER = '<!-- import-cost-ci -->'

interface PullRequestRef {
  owner: string
  repo: string
  issueNumber: number
}

interface GitHubIssueComment {
  id: number
  body: string
}

function parsePullRequestRef(): PullRequestRef | null {
  const repository = process.env.GITHUB_REPOSITORY
  const eventName = process.env.GITHUB_EVENT_NAME
  const eventPath = process.env.GITHUB_EVENT_PATH

  if (!repository || !eventName || !eventPath) {
    return null
  }

  if (!['pull_request', 'pull_request_target'].includes(eventName)) {
    return null
  }

  const [owner, repo] = repository.split('/')
  if (!owner || !repo) {
    return null
  }

  const event = JSON.parse(readFileSync(eventPath, 'utf8')) as { pull_request?: { number?: number } }
  const issueNumber = event.pull_request?.number

  if (!issueNumber) {
    return null
  }

  return { owner, repo, issueNumber }
}

function buildCommentBody(results: ImportResult[], limit: number): string {
  return `${COMMENT_MARKER}\n${formatResultsMarkdown(results, limit)}`
}

async function githubRequest<T>(url: string, init: RequestInit, token: string): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'import-cost-ci',
      ...init.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export async function maybePostGitHubComment(results: ImportResult[], limit: number): Promise<void> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    return
  }

  const pr = parsePullRequestRef()
  if (!pr) {
    return
  }

  const body = buildCommentBody(results, limit)
  const baseUrl = `https://api.github.com/repos/${pr.owner}/${pr.repo}/issues/${pr.issueNumber}/comments`
  const comments = await githubRequest<GitHubIssueComment[]>(baseUrl, { method: 'GET' }, token)
  const existing = comments.find((comment) => comment.body.includes(COMMENT_MARKER))

  if (existing) {
    await githubRequest(
      `https://api.github.com/repos/${pr.owner}/${pr.repo}/issues/comments/${existing.id}`,
      { method: 'PATCH', body: JSON.stringify({ body }) },
      token
    )
    return
  }

  await githubRequest(baseUrl, { method: 'POST', body: JSON.stringify({ body }) }, token)
}

export { buildCommentBody }
