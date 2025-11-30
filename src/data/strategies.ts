import type { ContentStrategy } from '../types/strategy.js';

export const CONTENT_STRATEGIES: ContentStrategy[] = [
  // Provocative
  {
    id: 'bold-observation',
    name: 'Bold, Provoking Observation',
    prompt: 'Make a bold, provoking observation. It might be something that you genuinely think, but taken to its extreme. Bold statements capture people\'s interest and spark conversations.',
    category: 'provocative',
    threadFriendly: false,
    applicability: {
      requiresStrongOpinion: true,
    },
  },
  {
    id: 'what-everyone-believes',
    name: 'Challenge Common Beliefs',
    prompt: 'What is something everyone believes to be true? Share your take on why it\'s not, make it spicy.',
    category: 'provocative',
    threadFriendly: true,
    applicability: {
      requiresStrongOpinion: true,
    },
  },
  {
    id: 'nobody-talks-about',
    name: 'What Nobody Talks About',
    prompt: 'What is something nobody talks about? Think about takeaways you usually don\'t read around.',
    category: 'provocative',
    threadFriendly: true,
    applicability: {
      requiresStrongOpinion: true,
    },
  },
  {
    id: 'controversial-idea',
    name: 'Share a Controversial Idea',
    prompt: 'Share a controversial idea you believe. If you truly believe it, don\'t fear the heat in your replies.',
    category: 'provocative',
    threadFriendly: true,
    applicability: {
      requiresStrongOpinion: true,
    },
  },

  // Engagement
  {
    id: 'repurpose-reply',
    name: 'Repurpose a Reply',
    prompt: 'Repurpose a reply to a question you\'re often being asked. For example, a friend\'s request or a frequent question about your business/product.',
    category: 'engagement',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'weekend-program',
    name: 'Weekend Plans Question',
    prompt: 'What\'s your program for the weekend? Involve your audience by asking a question for better results.',
    category: 'engagement',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'plan-for-today',
    name: 'Today\'s Plan',
    prompt: 'What\'s your plan for today? Optionally, ask your followers what\'s theirs.',
    category: 'engagement',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'question-about-topic',
    name: 'Ask About a Topic',
    prompt: 'Ask a question about a topic or niche. Let your followers give you their insights, or start a conversation.',
    category: 'engagement',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'ask-for-advice',
    name: 'Ask for Advice',
    prompt: 'Ask for advice on something you\'re unsure about. Be open. This is a good way to start a conversation.',
    category: 'engagement',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'ask-for-help',
    name: 'Ask for Help',
    prompt: 'Ask for help with an issue that you\'re facing. Got stuck with a tool? Are you struggling with a problem? Let your followers help you.',
    category: 'engagement',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'audience-problem',
    name: 'Ask About Their Problems',
    prompt: 'Ask your audience what\'s their problem about a specific topic. This is a great way to spark conversations, and learn from your followers.',
    category: 'engagement',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'offer-help',
    name: 'Offer Your Help',
    prompt: 'Offer your help to other people. If you\'re good at something and have time to help, this is always a great way to engage with your followers.',
    category: 'engagement',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'good-morning',
    name: 'Say Good Morning',
    prompt: 'Say good morning to a group of people. Target a topic or a group of people that you like.',
    category: 'engagement',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'introduce-yourself',
    name: 'Introduce Yourself',
    prompt: 'Introduce yourself to your new Twitter followers. Your recent followers might not really know you yet.',
    category: 'engagement',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'monday-feeling',
    name: 'Monday Motivation',
    prompt: 'It\'s Monday. How do you feel about it? Share your plan or a motivational thought to start the week.',
    category: 'engagement',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },

  // Personal
  {
    id: 'your-story',
    name: 'Share Your Story',
    prompt: 'What\'s your story? Share why you changed things. Make it aspirational, show the change.',
    category: 'personal',
    threadFriendly: true,
    applicability: {
      requiresPersonalNarrative: true,
    },
  },
  {
    id: 'worst-experience',
    name: 'Worst Experience',
    prompt: 'Share your worst experience with your followers. Tell the story, twist it with a learning, and ask your followers about theirs.',
    category: 'personal',
    threadFriendly: true,
    applicability: {
      requiresPersonalNarrative: true,
    },
  },
  {
    id: 'best-decision',
    name: 'Best Life Decision',
    prompt: 'What is the best decision you made in your life? Share the struggles, the achievement, the learnings.',
    category: 'personal',
    threadFriendly: true,
    applicability: {
      requiresPersonalNarrative: true,
    },
  },
  {
    id: 'recent-mistake',
    name: 'Recent Mistake',
    prompt: 'What mistake did you make recently? What did you learn? Tell people how they can avoid it.',
    category: 'personal',
    threadFriendly: true,
    applicability: {
      requiresPersonalNarrative: true,
    },
  },
  {
    id: 'small-win',
    name: 'Recent Small Win',
    prompt: 'Share a recent small win that makes you proud. Why does it matter? Attach a screenshot for extra engagement.',
    category: 'personal',
    threadFriendly: false,
    applicability: {
      requiresPersonalNarrative: true,
    },
  },
  {
    id: 'trap-fell-into',
    name: 'Trap You Fell Into',
    prompt: 'What trap did you fall into during the last few weeks? What\'s the lesson in it?',
    category: 'personal',
    threadFriendly: true,
    applicability: {
      requiresPersonalNarrative: true,
    },
  },
  {
    id: 'used-to-think',
    name: 'What You Used to Think',
    prompt: 'What were you used to do or think that now you don\'t? There are lessons ready to share behind mistakes or beliefs.',
    category: 'personal',
    threadFriendly: true,
    applicability: {
      requiresPersonalNarrative: true,
    },
  },
  {
    id: 'big-failure',
    name: 'Share a Big Failure',
    prompt: 'Share a big failure of yours. Bonus points if you make it funny and entertaining.',
    category: 'personal',
    threadFriendly: true,
    applicability: {
      requiresPersonalNarrative: true,
    },
  },
  {
    id: 'hobby-curious',
    name: 'Share Your Hobby',
    prompt: 'Do you have a hobby people should be curious about? It\'s not all about work. People are always interested to learn more about the things that you enjoy.',
    category: 'personal',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'passionate-about',
    name: 'Share Your Passion',
    prompt: 'Share something you are passionate about. It\'s a good conversation opener and creates connections.',
    category: 'personal',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'photo-of-love',
    name: 'Photo of Something You Love',
    prompt: 'Show a photo of something/someone you love. It might be your family trip, your dog, or even a pizza 🍕.',
    category: 'personal',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },

  // Educational
  {
    id: 'how-to-guide',
    name: 'Share a How-To Guide',
    prompt: 'Share a how-to guide about something you care about. How can you help your audience reach the goal?',
    category: 'educational',
    threadFriendly: true,
    applicability: {
      requiresActionableKnowledge: true,
    },
  },
  {
    id: 'time-saving-process',
    name: 'Time-Saving Process',
    prompt: 'What process do you have that saves you time? Share a process that other people can apply too.',
    category: 'educational',
    threadFriendly: true,
    applicability: {
      requiresActionableKnowledge: true,
    },
  },
  {
    id: 'habit-improved-life',
    name: 'Life-Improving Habit',
    prompt: 'What\'s a habit that improved your life? What do you do that gives you benefits?',
    category: 'educational',
    threadFriendly: true,
    applicability: {
      requiresActionableKnowledge: true,
    },
  },
  {
    id: 'share-framework',
    name: 'Share a Framework',
    prompt: 'Share a framework that you use with others. Help your followers to save time or be more productive. There might be things that you take for granted, but would be very helpful to them.',
    category: 'educational',
    threadFriendly: true,
    applicability: {
      requiresActionableKnowledge: true,
    },
  },
  {
    id: 'productivity-hack',
    name: 'Share a Productivity Hack',
    prompt: 'Share a productivity/growth/life hack. Save people time sharing something you already figured out.',
    category: 'educational',
    threadFriendly: false,
    applicability: {
      requiresActionableKnowledge: true,
    },
  },
  {
    id: 'advice-for-beginners',
    name: 'Advice for Beginners',
    prompt: 'What advice do beginners need to hear about your niche? Time to share your learnings.',
    category: 'educational',
    threadFriendly: true,
    applicability: {
      requiresActionableKnowledge: true,
    },
  },
  {
    id: 'useful-tools-list',
    name: 'List of Useful Tools',
    prompt: 'Make a list of useful tools for your audience/niche. What value does each tool provide? You can also make this a long-running thread.',
    category: 'educational',
    threadFriendly: true,
    applicability: {
      requiresResources: true,
    },
  },
  {
    id: 'tip-to-help',
    name: 'Share a Helpful Tip',
    prompt: 'Share a tip to help people save time or be more productive. Share your learnings, your followers will be grateful for this.',
    category: 'educational',
    threadFriendly: true,
    applicability: {
      requiresActionableKnowledge: true,
    },
  },
  {
    id: 'top-actionable-advice',
    name: 'Top 3-5 Actionable Advice',
    prompt: 'Share your top 3-5 actionable advice. Works best if you tie them to your niche/topic.',
    category: 'educational',
    threadFriendly: true,
    applicability: {
      requiresActionableKnowledge: true,
    },
  },
  {
    id: 'tool-tip',
    name: 'Tip on Using a Tool',
    prompt: 'Share a tip on how to use a product or tool successfully. It may be a product you use, or your own (Build in Public).',
    category: 'educational',
    threadFriendly: false,
    applicability: {
      requiresResources: true,
    },
  },

  // Behind-the-Scenes
  {
    id: 'progress-on-challenge',
    name: 'Progress on a Challenge',
    prompt: 'What progress did you make about a challenge that you\'re facing? Halfway through a goal, share setbacks, achievements, you name it.',
    category: 'behind-the-scenes',
    threadFriendly: false,
    applicability: {
      requiresProject: true,
    },
  },
  {
    id: 'goal-for-week',
    name: 'Goal for Next Week',
    prompt: 'What\'s your goal for the next week? Make a plan, then ask what your followers\' one is.',
    category: 'behind-the-scenes',
    threadFriendly: false,
    applicability: {
      requiresProject: true,
    },
  },
  {
    id: 'behind-the-scenes',
    name: 'Share Behind the Scenes',
    prompt: 'Share a behind the scenes. Trigger people\'s curiosity. It can be your workstation, something you\'re working on, or even a photo of your cat on the keyboard.',
    category: 'behind-the-scenes',
    threadFriendly: true,
    applicability: {
      requiresProject: true,
    },
  },
  {
    id: 'working-on-teaser',
    name: 'Teaser About Work',
    prompt: 'Share a teaser about something you\'re working on. People want to see what you\'re work in progress.',
    category: 'behind-the-scenes',
    threadFriendly: false,
    applicability: {
      requiresProject: true,
    },
  },
  {
    id: 'analytics-update',
    name: 'Share Analytics Update',
    prompt: 'Share an analytics update. Tie it to an achievement, analysis, or change you made.',
    category: 'behind-the-scenes',
    threadFriendly: false,
    applicability: {
      requiresProject: true,
    },
  },
  {
    id: 'milestone-reached',
    name: 'Share a Milestone',
    prompt: 'Share a milestone you\'ve reached. People are rooting for you and love this kind of update.',
    category: 'behind-the-scenes',
    threadFriendly: false,
    applicability: {
      requiresProject: true,
    },
  },
  {
    id: 'doing-photo',
    name: 'Photo of What You\'re Doing',
    prompt: 'Share a pic of what you\'re doing. Any activity/hobby/work you\'re doing is fine.',
    category: 'behind-the-scenes',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'project-progress',
    name: 'Show Project Progress',
    prompt: 'Show your progress on an active project. Share a screenshot about your product/customer/whatever.',
    category: 'behind-the-scenes',
    threadFriendly: false,
    applicability: {
      requiresProject: true,
    },
  },

  // Reflective
  {
    id: 'celebrate-3-days',
    name: 'Celebrate Last 3 Days',
    prompt: 'What\'s worth celebrating in the last 3 days? Reflect on small wins you have had in the last few days.',
    category: 'reflective',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'highlight-of-week',
    name: 'Highlight of the Week',
    prompt: 'What\'s your highlight of the week? Reflect on your week and share your best up or down.',
    category: 'reflective',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'biggest-achievement-month',
    name: 'Biggest Achievement Last Month',
    prompt: 'What\'s your biggest achievement from last month? Take a step back and look at what you\'ve done last month.',
    category: 'reflective',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'favorite-thing',
    name: 'Your Favorite Thing',
    prompt: 'What\'s your favorite thing about something? It can be a mindset thing, or something you like to do.',
    category: 'reflective',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'insights-last-month',
    name: 'Insights About Last Month',
    prompt: 'Share your insights about last month. They can be about Twitter, your product, your work, etc.',
    category: 'reflective',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'before-after',
    name: 'Share a Before/After Transformation',
    prompt: 'Share a before/after transformation. It can be about you/someone/a product you\'re working on.',
    category: 'reflective',
    threadFriendly: false,
    applicability: {
      requiresPersonalNarrative: true,
    },
  },

  // Curation
  {
    id: 'favorite-podcast',
    name: 'Favorite Podcast',
    prompt: 'What\'s a podcast you enjoy listening? Share their latest episode.',
    category: 'curation',
    threadFriendly: false,
    applicability: {
      requiresResources: true,
    },
  },
  {
    id: 'life-changing-book',
    name: 'Life-Changing Book',
    prompt: 'Share a life-changing book you read recently. People are always looking for good books to read.',
    category: 'curation',
    threadFriendly: false,
    applicability: {
      requiresResources: true,
    },
  },
  {
    id: 'resource-tool-share',
    name: 'Share a Resource/Tool',
    prompt: 'Share a resource/tool that people need to know about. If you find something useful, other people may like it too.',
    category: 'curation',
    threadFriendly: false,
    applicability: {
      requiresResources: true,
    },
  },
  {
    id: 'valuable-thread',
    name: 'Share a Valuable Thread',
    prompt: 'Share a thread you find valuable. Something you continue referring to.',
    category: 'curation',
    threadFriendly: false,
    applicability: {
      requiresResources: true,
    },
  },
  {
    id: 'newsletters-like',
    name: 'Share Newsletters You Like',
    prompt: 'Share one or more newsletters you like. Make people happy: the creator and the new subscribers.',
    category: 'curation',
    threadFriendly: false,
    applicability: {
      requiresResources: true,
    },
  },
  {
    id: 'article-perspective',
    name: 'Perspective on an Article',
    prompt: 'Share your perspective on an article you read. It could be a life-changing article or one you bookmarked.',
    category: 'curation',
    threadFriendly: true,
    applicability: {
      requiresResources: true,
    },
  },
  {
    id: 'curate-niche-content',
    name: 'Curate Content About Your Niche',
    prompt: 'Curate content about your niche. If you collect quality content (links, images, videos), give value to your followers by sharing it with them.',
    category: 'curation',
    threadFriendly: true,
    applicability: {
      requiresResources: true,
    },
  },
  {
    id: 'appreciate-helper',
    name: 'Appreciate Someone Who Helped',
    prompt: 'Appreciate someone who has helped you recently. What did they help you with? What have you learned?',
    category: 'curation',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'show-support',
    name: 'Show Support for Someone',
    prompt: 'Show your support for someone you like.',
    category: 'curation',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'quote-reframe',
    name: 'Quote a Tweet to Reframe',
    prompt: 'Quote a tweet to reframe it. Write it in a different way or add your thoughts. Look in your likes/bookmarks for great material to quote.',
    category: 'curation',
    threadFriendly: true,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'quote-support',
    name: 'Quote a Tweet to Show Support',
    prompt: 'Quote a tweet to show support. Let people know what you like, or something cool that you\'ve recently discovered.',
    category: 'curation',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'repurpose-reply-tweet',
    name: 'Repurpose a Reply to a Tweet',
    prompt: 'Repurpose a reply you wrote to someone else\'s tweet. There are plenty of ideas worth repurposing on your replies.',
    category: 'curation',
    threadFriendly: true,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'update-bio',
    name: 'Update Your Bio/Photo/Cover',
    prompt: 'Update your bio/photo/cover. There is a high chance to get many profile visits.',
    category: 'curation',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
  {
    id: 'meme-for-niche',
    name: 'Use a Popular Meme for Your Niche',
    prompt: 'Use a popular meme format, but for your niche. A good meme won\'t bring many new followers, but it will make people laugh.',
    category: 'curation',
    threadFriendly: false,
    applicability: {
      worksWithAnyContent: true,
    },
  },
];

export const STRATEGY_CATEGORIES = {
  personal: CONTENT_STRATEGIES.filter((s) => s.category === 'personal'),
  educational: CONTENT_STRATEGIES.filter((s) => s.category === 'educational'),
  provocative: CONTENT_STRATEGIES.filter((s) => s.category === 'provocative'),
  engagement: CONTENT_STRATEGIES.filter((s) => s.category === 'engagement'),
  curation: CONTENT_STRATEGIES.filter((s) => s.category === 'curation'),
  'behind-the-scenes': CONTENT_STRATEGIES.filter((s) => s.category === 'behind-the-scenes'),
  reflective: CONTENT_STRATEGIES.filter((s) => s.category === 'reflective'),
};
