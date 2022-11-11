type User = {
	id: string;
	name: string;
	username: string;
	host?: string;
	avatarUrl: string;
	avatarBlurhash: string;
	avatarColor?: any;
	isAdmin: boolean;
	emojis: any[];
	onlineStatus: string;
	driveCapacityOverrideMb?: any;
}
type Note = {
	id: string;
	createdAt: Date;
	userId: string;
	user: User;
	text?: string;
	cw?: string;
	visibility: 'public' | 'home' | 'followers' | 'specified';
	localOnly: boolean;
	renoteCount: number;
	repliesCount: number;
	reactions: any[];
	emojis: any[];
	fileIds: any[];
	files: any[];
	replyId?: string;
	renoteId?: string;
	reply: any;
}
export type webHookBody = {
	hookId: string;
	userId: string;
	eventId: string;
	createdAt: number;
	type: 'mention' | 'unfollow' | 'follow' | 'followed' | 'note' | 'reply' | 'renote' | 'reaction';
	body: {
		note: Note
	};
}