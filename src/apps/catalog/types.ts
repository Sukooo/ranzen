export interface PortalApp {
	name: string;
	/** CSS hex color, e.g. "#25599a". */
	color: string | null;
	/** The portal's icon classes or image name. */
	icon: string | null;
	folders: string[];
	url: string;
	/** The portal page for built-in apps, e.g. "meinunterricht.php"; null for linked services. */
	page: string | null;
	opensNewTab: boolean;
}
