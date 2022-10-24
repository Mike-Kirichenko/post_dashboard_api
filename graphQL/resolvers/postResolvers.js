const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { parse } = require("path");
const { Op } = require("sequelize");
const { User, Post, Category } = require("../../db/models");
const order = [["createdAt", "DESC"]];
const {
  getFinalQueryObject,
  formatWhereObj,
} = require("../../helpers/queryBuilder");

const { IMG_FOLDER_BASE } = process.env;

const Query = {
  post: (root, { id }, context) => {
    const { id: userId } = context.user;
    return Post.findOne({
      where: { userId, id },
      include: [{ model: User }, { model: Category }],
    });
  },

  posts: (root, { query }, context) => {
    const { id: userId } = context.user;
    let whereObjParams = { userId };
    let queryObjParams;
    let whereObj;
    let queryObj;

    if (query) {
      const { dateFrom, dateTo, search, page, limit } = query;
      whereObjParams = { userId, dateFrom, dateTo, search };
      queryObjParams = { page, limit };
    }

    whereObj = whereObjParams && formatWhereObj(whereObjParams);
    queryObj = getFinalQueryObject(queryObjParams, whereObj, [
      { model: User },
      { model: Category },
    ]);

    return {
      list: Post.findAll(queryObj),
      qty: Post.count({ where: whereObj }),
    };
  },
};

const Mutation = {
  createPost: async (root, { input, file }, context) => {
    const { id: userId } = context.user;

    const { createReadStream, filename } = await file;

    const { ext } = parse(filename);
    const finalName = `${uuidv4()}${ext}`;

    const stream = createReadStream();
    const fullPath = `${IMG_FOLDER_BASE}/posts/${finalName}`;
    const out = fs.createWriteStream(fullPath);
    await stream.pipe(out);

    const { id } = await Post.create({
      ...input,
      img: `posts/${finalName}`,
      userId,
    });

    return await Post.findOne({
      where: { userId, id },
      include: [{ model: User }, { model: Category }],
    });
  },
  deletePosts: async (root, { query, postIds }, context) => {
    const { id: userId } = context.user;
    let totalPostQty;
    let whereObjParams = { userId };
    let queryObjParams;
    let whereObj;
    let queryObj;
    let activePage;

    const foundRows = await Post.findAll({
      where: { id: { [Op.in]: postIds }, userId },
      attributes: ["img"],
    });

    const deleted = await Post.destroy({
      where: { id: { [Op.in]: postIds }, userId },
    });

    if (foundRows && deleted) {
      foundRows.forEach((row) => {
        const { img: imgPath } = row;
        if (fs.existsSync(`${IMG_FOLDER_BASE}/${imgPath}`)) {
          fs.unlinkSync(`${IMG_FOLDER_BASE}/${imgPath}`);
        }
      });

      if (query) {
        const { dateFrom, dateTo, search, page, limit } = query;
        activePage = page ? page : 1;
        whereObjParams = { userId, dateFrom, dateTo, search };
        queryObjParams = { page, limit };

        whereObj = whereObjParams && formatWhereObj(whereObjParams);
        queryObj = getFinalQueryObject(queryObjParams, whereObj, [
          { model: User },
          { model: Category },
        ]);

        totalPostQty = await Post.count({ where: whereObj });

        const totalPages = Math.ceil(totalPostQty / limit);

        if (page > 1 && page > totalPages) {
          queryObj.offset = (page - 1) * limit - limit;
          activePage = page - 1;
        }

        if (activePage > 1 && activePage > totalPages) {
          activePage = totalPages;
          queryObj.offset = activePage * limit - limit;
        }
      }

      const queryRelatedPosts = await Post.findAll({
        where: whereObj,
        ...queryObj,
        include: [{ model: User }, { model: Category }],
        order,
      });

      return {
        list: queryRelatedPosts,
        qty: totalPostQty,
        activePage,
      };
    }
    return {
      list: [],
      qty: totalPostQty,
      activePage,
    };
  },
  editPost: async (root, { id, input }, context) => {
    const { id: userId } = context.user;
    if (input) {
      const [updated] = await Post.update(input, { where: { id, userId } });
      if (updated) {
        const updated = await Post.findOne({
          where: { userId, id },
          include: [{ model: User }, { model: Category }],
        });
        return updated;
      }
    }
  },
};

module.exports = { Query, Mutation };
