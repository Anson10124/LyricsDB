CREATE TABLE "jwt" (
	"deezer" varchar(64) PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
