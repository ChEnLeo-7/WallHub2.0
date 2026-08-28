export const WORKSHOP_TYPES = ['Scene', 'Video', 'Web', 'Application'] as const;
export const VISIBLE_WORKSHOP_TYPES = ['Scene', 'Video', 'Web'] as const;
export const CONTENT_RATINGS = ['Everyone', 'Questionable', 'Mature'] as const;
export const WORKSHOP_GENRES = [
  'Abstract', 'Animal', 'Anime', 'Cartoon', 'CGI', 'Cyberpunk', 'Fantasy', 'Game', 'Girls', 'Guys',
  'Landscape', 'Medieval', 'Memes', 'MMD', 'Music', 'Nature', 'Pixel art', 'Relaxing', 'Retro', 'Sci-Fi',
  'Sports', 'Technology', 'Television', 'Vehicle', 'Unspecified',
] as const;
export const DEFAULT_WORKSHOP_GENRES = [...WORKSHOP_GENRES];
export const WORKSHOP_UTILITY_TAGS = [
  'Approved', 'Audio responsive', '3D', 'Customizable', 'Puppet Warp', 'HDR',
  'Media Integration', 'User Shortcut', 'Video Texture', 'Asset Pack',
] as const;
export const WORKSHOP_RESOLUTIONS = [
  'Standard', '1280 x 720', '1366 x 768', '1920 x 1080', '2560 x 1440', '3840 x 2160',
  'Ultrawide', '2560 x 1080', '3440 x 1440',
  'Dual monitor', '3840 x 1080', '5120 x 1440', '7680 x 2160',
  'Triple monitor', '4096 x 768', '5760 x 1080', '7680 x 1440', '11520 x 2160',
  'Portrait', '720 x 1280', '1080 x 1920', '1440 x 2560', '2160 x 3840',
  'Other resolution', 'Dynamic resolution',
] as const;

export const STEAM_RESOLUTION_TAGS: Record<string, string> = {
  Standard: 'Standard Definition',
  Ultrawide: 'Ultrawide Standard Definition',
  '2560 x 1080': 'Ultrawide 2560 x 1080',
  '3440 x 1440': 'Ultrawide 3440 x 1440',
  'Dual monitor': 'Dual Standard Definition',
  '3840 x 1080': 'Dual 3840 x 1080',
  '5120 x 1440': 'Dual 5120 x 1440',
  '7680 x 2160': 'Dual 7680 x 2160',
  'Triple monitor': 'Triple Standard Definition',
  '4096 x 768': 'Triple 4096 x 768',
  '5760 x 1080': 'Triple 5760 x 1080',
  '7680 x 1440': 'Triple 7680 x 1440',
  '11520 x 2160': 'Triple 11520 x 2160',
  Portrait: 'Portrait Standard Definition',
  '720 x 1280': 'Portrait 720 x 1280',
  '1080 x 1920': 'Portrait 1080 x 1920',
  '1440 x 2560': 'Portrait 1440 x 2560',
  '2160 x 3840': 'Portrait 2160 x 3840',
};
