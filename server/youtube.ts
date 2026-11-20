/** The subset of yt-dlp's video info that the app uses. */
export interface VideoInfo {
  id: string;
  title: string;
  webpage_url?: string;
  channel?: string;
  uploader?: string;
  description?: string;
  tags?: string[];
  /** Set by YouTube for music uploads ("Provided to YouTube by ..."). */
  artist?: string;
  track?: string;
  album?: string;
  release_year?: number;
  upload_date?: string;
}
