export const quests = {
  ideation: { title: '25 minutes of ideation', description: 'Explore a promising idea or gather references.', stage: 'ideation', session: true },
  scriptwriting: { title: '25 minutes of scriptwriting', description: 'Move a draft, outline, or script forward.', stage: 'scriptwriting', session: true },
  editing: { title: '25 minutes of editing', description: 'Give your footage a focused pass.', stage: 'editing', session: true },
  preparing: { title: '25 minutes of content preparation', description: 'Prepare a piece for its next production step.', stage: 'preparing', session: true },
  filming: { title: 'Film a video', description: 'Capture the footage you needed.', stage: 'filming', session: true },
  thumbnail: { title: 'Create a thumbnail', description: 'Make an image that helps viewers understand the video.', stage: 'preparing', session: false },
  short: { title: 'Publish a Short', description: 'Acknowledge getting a short-form video out into the world.', stage: 'published', session: false },
  long: { title: 'Publish a long-form video', description: 'Acknowledge releasing a long-form video.', stage: 'published', session: false },
} as const
export type QuestKey = keyof typeof quests
export const questKeys = Object.keys(quests) as QuestKey[]
