const stripe = require('stripe')('sk_test_N052M4ctKJ4GN3KYepb9Wjbx00LEg1FcBl');
const Busboy = require("busboy")

/*ログ用。AccountIDとappUserIDは何を示す？messageはログメッセージ。infofとerrorfが分かれている理由は？*/
function infof(accountId, appUserId, message) {
  console.log('account_id=' + accountId + ',app_user_id=' + appUserId + ': ' + message)
}
function errorf(accountId, appUserId, message) {
  console.log('account_id=' + accountId + ',app_user_id=' + appUserId + ': ' + message)
}

exports.handler = async (event) => {
    // API Connectorに対して、成功時とエラー時で共通のデータ構造を返す。
    // API Connectorは「`Initialize call` したときのレスポンス」のデータ構造しか扱えない。
    print(event)
    let body = {
      external_account: {
        id: '',
        object: 'bank_account',
        account: '',
        account_holder_name: '',
        account_holder_type: '',
        bank_name: '',
        country: 'JP',
        currency: 'jpy',
        default_for_currency: '',
        fingerprint: '',
        last4: '',
        // metadataのデータ構造を変更する度、BubbleのAPI Connectorで `Reinitialize` すること
        metadata: {
          // アプリケーションの独自データをmetadataで保持できる
          // 検索例: https://dashboard.stripe.com/test/search?query=metadata%3Auser_id%3D1
          user_id: ''
        },
        routing_number: '',
        status: ''
      },
      // Stripe APIエラーレスポンスの `raw.param` の値が入る
      error_param: ''
    }

    // BubbleのAPI Connectorのリクエストはmultipart/form-dataになっている。
    // Cloud Functionsはmultipart/form-dataのリクエストを受け取ると `request.body` が空になり、
    // `request.rawBody` にパラメータが入る。
    // 参考: https://cloud.google.com/functions/docs/writing/http?hl=ja#writing_http_helloworld-nodejs
	const busboy = new Busboy({ headers: event.headers })
    let params = {}
    busboy.on('field', (fieldname, value, _, __) => {
      params[fieldname] = value
    }).on('finish', async () => {
      let accountId = params.account_id
      infof(accountId, params.app_user_id, 'Start')
      infof(accountId, params.app_user_id, 'params ' + JSON.stringify(params))
      if (event.method !== 'POST') {
        infof(accountId, params.app_user_id, 'Finalize')
        return new Promise.reject(new Error('Invalid request'))
      }
			/*stripeのアカウントにaccountIdの情報を取得。エラーがあればエラー処理*/
      let account = await stripe.accounts.retrieve(accountId)
        .catch(error => {
          body.error_param = 'account_id'
          errorf(accountId, params.app_user_id, error)
          return error
        })
      let isRetrieved = typeof (account.id) === 'string'
      if (!isRetrieved) {
        errorf(accountId, params.app_user_id, 'Finalize')
        return body
      }
      await stripe.accounts.createExternalAccount(accountId, {
        external_account: {
          object: 'bank_account',
          country: 'JP',
          currency: 'jpy',
          default_for_currency: true,
          account_number: params.account_number,
          routing_number: params.bank_number + params.branch_number,
          account_holder_name: params.account_holder_name,
          metadata: {
            user_id: params.app_user_id
          }
        }
			/*成功したらExternal Accountを返す*/
      }).then(externalAccount => {
        infof(accountId, params.app_user_id, 'Created external_account: ' + externalAccount.id)
        body.external_account = externalAccount
        return externalAccount
			/*エラーをキャッチしたら、エラーに対応したエラー文をbody.error_param設定*/
      }).catch(error => {
        errorf(accountId, params.app_user_id, error)
        if (error.raw === undefined) {
          return error
        }
        if (error.raw.code === 'account_invalid') {
          body.error_param = 'account_id'
        }
        switch (error.raw.param) {
          case 'external_account[account_number]':
            body.error_param = 'external_account[account_number]'
            break;
          case 'external_account[routing_number]':
            body.error_param = 'external_account[routing_number]'
            break;
          case 'external_account[account_holder_name]':
            body.error_param = 'external_account[account_holder_name]'
            break;
        }
        return error
      })
      //response.send(body)//Cloud functionsの作法
      infof(accountId, params.app_user_id, 'End')
      return body;
    })
    busboy.end(event.rawBody)
};
