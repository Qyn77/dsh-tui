/**
 * How a skill invocation looks in the transcript.
 *
 * The injected body is a rendered `<skill_content>` block — markup the user
 * never wrote and cannot act on. `@deepseek-ai/dsh-skill` puts the skill's name
 * in the message source exactly so a transcript can say which skill ran
 * without sampling that markup, and this file pins that we do.
 * @module @deepseek-ai/dsh-tui/tests/skill-frame.spec
 */

import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { paintApp } from './fake-tty.ts'

const BODY = renderSkillContent({
  name: 'review',
  provider: 'filesystem',
  content: 'Read the diff and list what would break in production.',
})

/** Append the two messages a `/review` invocation produces, in the order the app sends them. */
async function invoke(
  painted: Awaited<ReturnType<typeof paintApp>>,
  words = 'the auth change',
) {
  await painted.append('user/message', createUserMessage({
    content: [{ type: 'text', text: BODY }],
    source: { kind: 'skill-invocation', name: 'review', form: 'instructions' },
  }), { surfaceOp: 'append' })
  await painted.append('user/message', createUserMessage({
    content: [{ type: 'text', text: words }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

describe('an invoked skill', () => {
  it('names the skill on its own row', async () => {
    const painted = await paintApp({ rows: 40 })
    await invoke(painted)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('skill review')
  })

  it('does not print the model-facing markup at the user', async () => {
    const painted = await paintApp({ rows: 40 })
    await invoke(painted)
    const screen = painted.screen()
    painted.unmount()

    // The whole point of the source variant: label from metadata, never
    // preview the payload.
    expect(screen).not.toContain('skill_content')
    expect(screen).not.toContain('Read the diff')
  })

  it('does not label the injection as something the user said', async () => {
    const painted = await paintApp({ rows: 40 })
    await invoke(painted)
    const rows = painted.screen().split('\n')
    painted.unmount()

    const label = rows.find(r => r.includes('skill review'))
    expect(label).toBeDefined()
    // The user's own box is a bordered frame; a runtime row is not one.
    expect(label).not.toContain('│')
  })

  it('does not call the injection a generic runtime context', async () => {
    const painted = await paintApp({ rows: 40 })
    await invoke(painted)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).not.toContain('runtime context')
  })

  it('shows the user’s own words as their message', async () => {
    const painted = await paintApp({ rows: 40 })
    await invoke(painted)
    const rows = painted.screen().split('\n')
    painted.unmount()

    const words = rows.findIndex(r => r.includes('the auth change'))
    expect(words).toBeGreaterThanOrEqual(0)
    expect(rows[words]).toContain('│')
  })

  it('keeps a plugin injection labelled the way it always was', async () => {
    const painted = await paintApp({ rows: 40 })
    await painted.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'remember the house style' }],
      source: { kind: 'plugin', plugin: 'agent-instructions', form: 'instructions' },
    }), { surfaceOp: 'append' })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('agent-instructions')
    expect(screen).toContain('instructions')
  })
})
