/*
 Navicat Premium Data Transfer

 Source Server         : localhost
 Source Server Type    : PostgreSQL
 Source Server Version : 90104
 Source Host           : localhost
 Source Database       : relspider
 Source Schema         : public

 Target Server Type    : PostgreSQL
 Target Server Version : 90104
 File Encoding         : utf-8

 Date: 07/30/2012 19:22:42 PM
*/

-- ----------------------------
--  Table structure for "hosts"
-- ----------------------------
DROP TABLE IF EXISTS "hosts";
CREATE TABLE "hosts" (
	"host" varchar(255) NOT NULL,
	"added" timestamp(6) NOT NULL,
	"fetched" timestamp(6) NOT NULL,
	"count" int4 NOT NULL
)
WITH (OIDS=FALSE);

-- ----------------------------
--  Table structure for "urls"
-- ----------------------------
DROP TABLE IF EXISTS "urls";
CREATE TABLE "urls" (
	"url" varchar(1024) NOT NULL,
	"node" int4,
	"added" timestamp(6) NOT NULL,
	"requested" timestamp(6) NULL,
	"fetched" timestamp(6) NULL,
	"locked" timestamp(6) NULL,
	"refresh" bool NOT NULL DEFAULT false,
	"completed" bool NOT NULL DEFAULT false,
	"disallowed" bool NOT NULL DEFAULT false,
	"failed" int2 NOT NULL DEFAULT 0
)
WITH (OIDS=FALSE);

-- ----------------------------
--  Table structure for "webhooks"
-- ----------------------------
DROP TABLE IF EXISTS "webhooks";
CREATE TABLE "webhooks" (
	"hook" varchar(1024) NOT NULL,
	"url" varchar(1024) NOT NULL,
	"added" timestamp(6) NOT NULL,
	"fired" timestamp(6) NULL
)
WITH (OIDS=FALSE);

-- ----------------------------
--  Primary key structure for table "hosts"
-- ----------------------------
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_pkey" PRIMARY KEY ("host") NOT DEFERRABLE INITIALLY IMMEDIATE;

-- ----------------------------
--  Primary key structure for table "urls"
-- ----------------------------
ALTER TABLE "urls" ADD CONSTRAINT "urls_pkey" PRIMARY KEY ("url") NOT DEFERRABLE INITIALLY IMMEDIATE;

-- ----------------------------
--  Primary key structure for table "webhooks"
-- ----------------------------
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_pkey" PRIMARY KEY ("hook", "url") NOT DEFERRABLE INITIALLY IMMEDIATE;

